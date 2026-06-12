// ПОЛИСАД: временной слой (дневной цикл Telegram-бота).
// Имя дневного треда, экстрактивная свёртка переполненного окна,
// summary вчерашнего дня. Всё без LLM.

import type { Db, PolisadMessage } from './types.ts';

export const BOT_THREAD_TITLE = 'Telegram Bot';
export const CONTEXT_WINDOW = 50;

const FOLD_MAX_CHARS = 1500;      // максимум на блок «Раньше сегодня»
const FOLD_MSG_MAX_CHARS = 200;   // максимум на одну реплику в свёртке

export function botThreadTitle(dateStr: string): string {
  return `${BOT_THREAD_TITLE} ${dateStr}`;
}

// Экстрактивная свёртка записей, выпавших за CONTEXT_WINDOW: только реплики
// пользователя, без LLM. Возвращает '' если сворачивать нечего.
export function foldOverflowMessages(msgs: PolisadMessage[]): string {
  if (msgs.length <= CONTEXT_WINDOW) return '';
  const overflow = msgs.slice(0, msgs.length - CONTEXT_WINDOW);
  const lines: string[] = [];
  for (const m of overflow) {
    if (m.role !== 'user') continue;
    const text = (typeof m.content === 'string' ? m.content : '').trim();
    if (!text) continue;
    lines.push('— ' + (text.length > FOLD_MSG_MAX_CHARS ? text.slice(0, FOLD_MSG_MAX_CHARS) + '…' : text));
  }
  if (lines.length === 0) return '';
  // при переполнении блока выкидываем самые старые строки
  let block = lines.join('\n');
  while (block.length > FOLD_MAX_CHARS && lines.length > 1) {
    lines.shift();
    block = lines.join('\n');
  }
  return block;
}

// Summary вчерашнего дневного треда бота (для блока «Вчера в боте»).
export async function getYesterdaySummary(db: Db, userId: string, userTz: string): Promise<string | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: userTz });
  const { rows } = await db.query(
    `SELECT summary FROM user_threads
     WHERE user_id = $1 AND title = $2 AND summary IS NOT NULL
     LIMIT 1`,
    [userId, botThreadTitle(yesterdayStr)]
  );
  return rows[0]?.summary || null;
}
