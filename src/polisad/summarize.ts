// ПОЛИСАД: саммаризация — единственный этап, где используется LLM.
// Память не существует без саммаризации: summary — это то, что инжектируется
// в промпт и (пока) то, по чему ищет vector search.

import type { ChatCall, Db, PolisadMessage, SummarizeResult } from './types.ts';
import { generateEmbedding } from './embeddings.ts';
import { scoreMeaningful } from './meaningful.ts';
import { markSupersededFacts } from './supersede.ts';

const SUMMARIZE_SYSTEM_PROMPT = `Ты — Мысль, персональный ИИ-ассистент. Проанализируй диалог и верни JSON-объект:
{
  "is_meaningful": true/false,
  "summary": "..."
}

is_meaningful = true если диалог содержит: цели, планы, задачи, решения, важные мысли, информацию о пользователе, его проектах или приоритетах.
is_meaningful = false если диалог: короткий small-talk, технические тесты, приветствия, бессодержательные реплики.

Если is_meaningful = true, summary — структурированная заметка:
**Суть:** одно предложение — о чём был разговор.
**Ключевые тезисы:** 2–4 буллет-пункта с главными мыслями и решениями.
**Задачи:** (только если были явно упомянуты) краткий список.

Если is_meaningful = false, summary = "".
Пиши по-русски. Верни только валидный JSON, без markdown-обёртки.`;

// Ядро саммаризации: вызывает LLM, парсит JSON, обновляет БД, генерирует эмбеддинг.
// Используется в /api/summarize (ручной триггер) и в sweep (автоматический).
// Возвращает null при ошибке LLM-провайдера.
export async function summarizeThreadCore(
  db: Db | null,
  callChat: ChatCall,
  apiKey: string,
  threadId: string,
  userId: string,
  messages: PolisadMessage[]
): Promise<SummarizeResult | null> {
  const { verdict } = scoreMeaningful(messages);
  if (verdict === 'noise') {
    // явный шум — LLM не нужна
    if (db && threadId && userId) {
      await db.query(
        `UPDATE user_threads SET summary = NULL, is_meaningful = false, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        [threadId, userId]
      );
    }
    return { summary: '', isMeaningful: false };
  }

  const dialogText = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => `${m.role === 'user' ? 'Пользователь' : 'Мысль'}: ${String(m.content || '')}`)
    .join('\n');

  const response = await callChat({
    model: 'deepseek/deepseek-v4-flash',
    messages: [
      { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
      { role: 'user', content: `Диалог:\n\n${dialogText}` },
    ],
    max_tokens: 600,
    temperature: 0.2,
    thinking: false,
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || '';

  let summary = '';
  let isMeaningful = false;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    isMeaningful = Boolean(parsed.is_meaningful);
    summary = isMeaningful ? (parsed.summary || '') : '';
  } catch {
    // Если модель не вернула JSON — считаем контент саммари, is_meaningful = true
    summary = rawContent;
    isMeaningful = rawContent.length > 20;
  }

  if (db && threadId && userId) {
    await db.query(
      `UPDATE user_threads SET summary = $1, is_meaningful = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4`,
      [summary || null, isMeaningful, threadId, userId]
    );

    if (isMeaningful && summary) {
      const threadRes = await db.query(
        `SELECT title FROM user_threads WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [threadId, userId]
      );
      const title = threadRes.rows?.[0]?.title || '';
      const embedding = await generateEmbedding(`${title}\n${summary}`, apiKey);
      if (embedding) {
        await db.query(
          `UPDATE user_threads SET embedding = $1::vector WHERE id = $2 AND user_id = $3`,
          [`[${embedding.join(',')}]`, threadId, userId]
        );
      }

      // Перезапись: сверяем новый факт с прежними, помечаем устаревшие.
      // Fire-and-forget — не блокируем и не роняем саммаризацию.
      markSupersededFacts(db, callChat, userId, threadId, summary)
        .catch((e: any) => console.warn('[polisad/summarize] supersede skipped:', e?.message));
    }
  }

  return { summary, isMeaningful };
}

// ── Sweep: авто-саммаризация остывших тредов ──────────────────────────────────

export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_COLD_MINUTES = 30;   // тред «остыл» после 30 мин тишины
const SWEEP_BATCH = 10;          // максимум тредов за проход (плавный backfill истории)
const SWEEP_RETRY_HOURS = 6;     // повторная попытка после неудачи

export async function sweepColdThreads(db: Db | null, callChat: ChatCall, apiKey: string | undefined): Promise<void> {
  if (!db || !apiKey) return;

  const { rows } = await db.query(`
    SELECT id, user_id, messages FROM user_threads
    WHERE summary IS NULL
      AND is_meaningful IS DISTINCT FROM false
      AND source IS DISTINCT FROM 'заметка'
      AND label IS DISTINCT FROM 'profile'
      AND title IS DISTINCT FROM 'О себе'
      AND updated_at < NOW() - INTERVAL '${SWEEP_COLD_MINUTES} minutes'
      AND (summary_attempted_at IS NULL OR summary_attempted_at < NOW() - INTERVAL '${SWEEP_RETRY_HOURS} hours')
    ORDER BY updated_at ASC
    LIMIT ${SWEEP_BATCH}
  `);

  for (const row of rows) {
    try {
      await db.query(`UPDATE user_threads SET summary_attempted_at = NOW() WHERE id = $1`, [row.id]);
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const userMsgCount = messages.filter((m: any) => m.role === 'user' && String(m.content || '').trim()).length;
      if (userMsgCount < 2) {
        // нечего саммаризировать — пометить, чтобы не сканировать вечно
        await db.query(`UPDATE user_threads SET is_meaningful = false WHERE id = $1`, [row.id]);
        continue;
      }
      await summarizeThreadCore(db, callChat, apiKey!, row.id, row.user_id, messages);
    } catch (e: any) {
      console.warn('[polisad/sweep]', row.id, e?.message);
    }
  }
}

// ── Саммаризация дневного треда бота ─────────────────────────────────────────
// Отдельный, более простой промпт: сжатие дня в 3-5 предложений.
// onSummarized — хук для пост-обработки transcript (извлечение фактов и т.п.).

export async function summarizeBotThread(
  db: Db,
  apiKey: string,
  threadId: string,
  messages: PolisadMessage[],
  onSummarized?: (transcript: string) => void
): Promise<void> {
  const meaningful = messages.filter(m => m.role !== 'tool' && m.content?.trim());
  if (meaningful.length < 4) return; // слишком короткий тред — не саммаризируем

  const transcript = meaningful
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Мысль'}: ${m.content}`)
    .join('\n');

  try {
    const response = await fetch('https://routerai.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{
          role: 'user',
          content: `Сожми этот разговор в 3-5 предложений. Сохрани суть: о чём говорили, какие решения приняли, что важного сказал пользователь о себе или своих планах. Без воды.\n\n${transcript.slice(0, 6000)}`
        }],
        max_tokens: 300,
        temperature: 0.3,
        thinking: false,
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary || summary.length < 20) return;

    await db.query(
      `UPDATE user_threads SET summary = $1, is_meaningful = true WHERE id = $2`,
      [summary, threadId]
    );
    console.log(`[Bot] саммари создан для треда ${threadId}`);

    if (onSummarized) onSummarized(transcript);
  } catch (e: any) {
    console.warn('[Bot] саммаризация не удалась:', e?.message);
  }
}
