// ПОЛИСАД: перезапись фактов (contradiction-driven supersession).
//
// ACT-R объясняет ЗАБЫВАНИЕ (factу давно не подкрепляли → тонет), но не умеет
// в ПРОТИВОРЕЧИЯ: «уволился из X» не делает старый факт «работает в X» просто
// менее активным — он делает его НЕВЕРНЫМ. Затухание тут не спасёт: неверный
// факт может всплыть, если тема горячая. Его надо явно вычеркнуть.
//
// Принцип архитектуры держим: retrieval — это математика без LLM. Поэтому
// разрешение противоречий вешаем на момент САММАРИЗАЦИИ, где LLM и так в контуре.
// Когда новый осмысленный факт записан — сверяем его с существующими фактами
// пользователя и помечаем устаревшие superseded_at. Дальше они навсегда выпадают
// из профиля и RAG (фильтр superseded_at IS NULL).

import type { ChatCall, Db } from './types.ts';

const SUPERSEDE_SYSTEM_PROMPT = `Ты — система контроля памяти ассистента. Тебе дают НОВЫЙ факт о пользователе и список СТАРЫХ фактов с номерами.
Твоя задача — найти старые факты, которые новый делает УСТАРЕВШИМИ или НЕВЕРНЫМИ.

Помечай факт устаревшим ТОЛЬКО если новый прямо ему противоречит или отменяет:
- сменил работу/город/роль/инструмент → старое место устарело
- цель достигнута, проект закрыт, отношения изменились → старый статус устарел

НЕ помечай, если факты просто о разном, дополняют друг друга или совместимы.
Лучше не пометить, чем пометить лишнее: ложная перезапись стирает верную память.

Верни строго JSON без markdown: {"superseded": [номера старых фактов]}.
Если ничего не устарело — {"superseded": []}.`;

// Сколько недавних фактов сверяем с новым. Профиль + горсть свежих —
// дальше латентность/стоимость не оправданы, а старое и так тонет по ACT-R.
const SUPERSEDE_CANDIDATE_LIMIT = 8;
const SUPERSEDE_MAX_SUMMARY_CHARS = 400;

interface CandidateFact {
  id: string;
  summary: string;
}

// Помечает устаревшие факты пользователя на основе нового summary.
// Fire-and-forget по духу: ошибка LLM/БД не должна ронять саммаризацию.
// Возвращает id помеченных тредов (для тестов/логов).
export async function markSupersededFacts(
  db: Db,
  callChat: ChatCall,
  userId: string,
  newThreadId: string,
  newSummary: string
): Promise<string[]> {
  const text = (newSummary || '').trim();
  if (text.length < 20) return [];

  // Кандидаты: профильные факты + недавние осмысленные треды, кроме самого нового
  // и уже перезаписанных. Профиль приоритетен — именно он навязывается безусловно.
  const { rows } = await db.query(
    `SELECT id, summary FROM user_threads
     WHERE user_id = $1
       AND id <> $2
       AND summary IS NOT NULL
       AND is_meaningful IS NOT FALSE
       AND superseded_at IS NULL
     ORDER BY
       (title = 'О себе' OR label = 'profile') DESC,
       updated_at DESC
     LIMIT ${SUPERSEDE_CANDIDATE_LIMIT}`,
    [userId, newThreadId]
  );
  const candidates: CandidateFact[] = rows
    .map((r: any) => ({ id: String(r.id), summary: String(r.summary || '').slice(0, SUPERSEDE_MAX_SUMMARY_CHARS) }))
    .filter((c: CandidateFact) => c.summary.length > 0);
  if (candidates.length === 0) return [];

  const oldList = candidates.map((c, i) => `${i + 1}. ${c.summary}`).join('\n');

  let supersededIdx: number[] = [];
  try {
    const response = await callChat({
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        { role: 'system', content: SUPERSEDE_SYSTEM_PROMPT },
        { role: 'user', content: `НОВЫЙ факт:\n${text.slice(0, SUPERSEDE_MAX_SUMMARY_CHARS)}\n\nСТАРЫЕ факты:\n${oldList}` },
      ],
      max_tokens: 120,
      temperature: 0,
      thinking: false,
    });
    if (!response.ok) return [];
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (Array.isArray(parsed.superseded)) {
      supersededIdx = parsed.superseded
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= candidates.length);
    }
  } catch (e: any) {
    console.warn('[polisad/supersede] detect failed:', e?.message);
    return [];
  }

  const ids = [...new Set(supersededIdx)].map(n => candidates[n - 1].id);
  if (ids.length === 0) return [];

  try {
    await db.query(
      `UPDATE user_threads SET superseded_at = NOW(), superseded_by = $1
       WHERE id = ANY($2::text[]) AND user_id = $3 AND superseded_at IS NULL`,
      [newThreadId, ids, userId]
    );
    console.log(`[polisad/supersede] факт(ы) перезаписаны тредом ${newThreadId}:`, ids);
  } catch (e: any) {
    console.warn('[polisad/supersede] mark failed:', e?.message);
    return [];
  }
  return ids;
}
