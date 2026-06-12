// ПОЛИСАД: детерминированная оценка значимости диалога — без LLM.
// Явный шум отсеивается до саммаризации; серая зона уходит в LLM как раньше.

import type { PolisadMessage } from './types.ts';

const SMALL_TALK = new Set([
  'привет', 'здравствуй', 'здравствуйте', 'хай', 'ку', 'йо', 'добрый день',
  'добрый вечер', 'доброе утро', 'пока', 'спасибо', 'спс', 'ок', 'окей',
  'ясно', 'понятно', 'ага', 'угу', 'да', 'нет', 'тест', 'test', 'проверка',
  'как дела', 'что умеешь', 'кто ты', 'хорошо', 'норм', 'ладно', '123', 'апдейт',
]);

export type MeaningfulVerdict = 'meaningful' | 'noise' | 'uncertain';

export function scoreMeaningful(messages: PolisadMessage[]): { score: number; verdict: MeaningfulVerdict } {
  const userMsgs = messages
    .filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .map(m => (m.content as string).trim());
  const hasToolCalls = messages.some(m => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);

  let score = 0;
  if (userMsgs.length >= 3) score += 2;
  const totalLen = userMsgs.reduce((s, t) => s + t.length, 0);
  if (totalLen >= 200) score += 2;
  if (hasToolCalls) score += 3; // создание задач = всегда значимо

  // маркеры контента: цифры/даты или имя собственное не в начале реплики
  const joined = userMsgs.join(' ');
  if (/\d/.test(joined)) score += 1;
  if (userMsgs.some(t => /\s[А-ЯЁ][а-яё]+/.test(t))) score += 1;

  // штрафы
  const normalize = (t: string) => t.toLowerCase().replace(/[^\wа-яё\s]/gi, '').trim();
  const allSmallTalk = userMsgs.length > 0 && userMsgs.every(t => SMALL_TALK.has(normalize(t)));
  if (allSmallTalk) score -= 3;
  const avgLen = userMsgs.length > 0 ? totalLen / userMsgs.length : 0;
  if (avgLen < 10) score -= 2;

  let verdict: MeaningfulVerdict;
  if (score <= 0) verdict = 'noise';
  else if (score >= 3) verdict = 'meaningful';
  else verdict = 'uncertain';

  // Страховка от false negative: развёрнутая реплика (≥40 символов, не small-talk)
  // никогда не отсекается без LLM — эвристика экономит вызовы, но не теряет память.
  const hasSubstantiveMsg = userMsgs.some(t => t.length >= 40 && !SMALL_TALK.has(normalize(t)));
  if (verdict === 'noise' && hasSubstantiveMsg) verdict = 'uncertain';

  return { score, verdict };
}
