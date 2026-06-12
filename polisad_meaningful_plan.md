# План: эвристика is_meaningful до LLM (ПОЛИСАД, шаг 2 роадмапа)

> Исполнитель: Sonnet 4.6. Следуй плану дословно. Противоречие плана и кода — остановись и спроси.
> Прод с живыми данными. БД и SQL не трогать. server.ts / server-bot.ts не трогать.

## Проблема
Сейчас LLM решает, значим ли диалог (is_meaningful), для КАЖДОГО треда — включая очевидный мусор («привет», «тест»). Это лишние LLM-вызовы и задержка.

## Решение (математика вместо LLM)
Детерминированная скоринговая функция классифицирует тред ДО вызова LLM:
- явный шум → is_meaningful = false без LLM (экономия вызова)
- явно значимый или серая зона → LLM вызывается как раньше (качество не падает)

## Изменения

### 1. Новый файл src/polisad/meaningful.ts
```ts
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
    .map(m => m.content.trim());
  const hasToolCalls = messages.some(m => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);

  let score = 0;
  if (userMsgs.length >= 3) score += 2;
  const totalLen = userMsgs.reduce((s, t) => s + t.length, 0);
  if (totalLen >= 200) score += 2;
  if (hasToolCalls) score += 2; // создание задач = всегда значимо

  // маркеры контента: цифры/даты или имя собственное не в начале реплики
  const joined = userMsgs.join(' ');
  if (/\d/.test(joined)) score += 1;
  if (userMsgs.some(t => /\s[А-ЯЁ][а-яё]+/.test(t))) score += 1;

  // штрафы
  const normalize = (t: string) => t.toLowerCase().replace(/[^\wа-яё\s]/gi, '').trim();
  const allSmallTalk = userMsgs.length > 0 && userMsgs.every(t => SMALL_TALK.has(normalize(t)));
  if (allSmallTalk) score -= 3;
  const avgLen = userMsgs.length > 0 ? totalLen / userMsgs.length : 0;
  if (avgLen < 15) score -= 2;

  let verdict: MeaningfulVerdict;
  if (score <= 0) verdict = 'noise';
  else if (score >= 3) verdict = 'meaningful';
  else verdict = 'uncertain';
  return { score, verdict };
}
```

### 2. Интеграция в src/polisad/summarize.ts → summarizeThreadCore
В начало функции, ДО вызова callChat:
```ts
const { verdict } = scoreMeaningful(messages);
if (verdict === 'noise') {
  // явный шум — LLM не нужна
  if (db && threadId && userId) {
    await db.query(
      `UPDATE user_threads SET summary = NULL, is_meaningful = false, updated_at = NOW() WHERE id = $2 AND user_id = $3`.replace('$2', '$1').replace('$3', '$2'),
      [threadId, userId]
    );
  }
  return { summary: '', isMeaningful: false };
}
```
ВНИМАНИЕ: перепиши UPDATE нормально (это подсказка о полях, не готовый код):
`UPDATE user_threads SET summary = NULL, is_meaningful = false, updated_at = NOW() WHERE id = $1 AND user_id = $2`.
Дальше функция работает без изменений (LLM-путь для meaningful/uncertain).
Импорт: `import { scoreMeaningful } from './meaningful.ts';`

### 3. Экспорт в src/polisad/index.ts
```ts
export { scoreMeaningful } from './meaningful.ts';
export type { MeaningfulVerdict } from './meaningful.ts';
```

### 4. Тесты tests/unit/polisad/meaningful.test.ts (node:test, по образцу activation.test.ts)
Кейсы:
- ['привет'] → noise
- ['привет', 'как дела'] → noise
- ['тест'] → noise
- 3+ содержательных реплики суммарно >200 символов → meaningful
- диалог с tool_calls (assistant с tool_calls) → не noise (score ≥ 2)
- 2 коротких содержательных реплики («купить молоко», «завтра в 15:00») → НЕ noise (uncertain или meaningful — цифры дают балл)
- пустой массив / только assistant-реплики → noise

## Что НЕ делать
- Не менять серверы: summarizeThreadCore вызывается оттуда как раньше, сигнатура не меняется.
- Не менять sweep (его проверка userMsgCount < 2 остаётся первой линией).
- Не менять summarizeBotThread (у дневных тредов бота своя логика meaningful ≥ 4).
- Никаких новых зависимостей.

## Проверка
1. `npx tsc --noEmit` — чисто.
2. `NODE_ENV=test node --import tsx --test tests/unit/**/*.test.ts` — было 111 pass / 1 fail (exports.test.ts, старый), новых падений нет, новые тесты проходят.
3. Ничего не коммитить.
