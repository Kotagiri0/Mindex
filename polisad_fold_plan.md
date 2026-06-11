# План: «Раньше сегодня» — экстрактивная свёртка переполненного дневного окна (ПОЛИСАД, шаг 1.5)

> Исполнитель: Sonnet 4.6. Следуй плану дословно. Противоречие плана и кода — остановись и спроси.
> Прод с живыми данными. Изменения ТОЛЬКО в server-bot.ts. server.ts не трогать. БД не трогать — миграций нет.

## Проблема
Бот передаёт в промпт только последние `CONTEXT_WINDOW = 50` записей дневного треда (`buildSafeHistory`, строка ~468). При активном дне утренние сообщения выпадают из окна → бот к вечеру переспрашивает обсуждённое утром. Поднимать окно дальше нельзя — токены растут на каждое сообщение.

## Решение (без LLM)
Записи, выпавшие за окно, сворачиваются экстрактивно: берутся только реплики пользователя, склеиваются в компактный блок `## Раньше сегодня`, который дописывается в конец системного промпта. Свежие 50 записей идут полной историей как сейчас.

## Изменения в server-bot.ts

### 1. Новая функция (разместить рядом с buildSafeHistory, ~строка 466)
```ts
const FOLD_MAX_CHARS = 1500;      // максимум на блок «Раньше сегодня»
const FOLD_MSG_MAX_CHARS = 200;   // максимум на одну реплику в свёртке

// Экстрактивная свёртка записей, выпавших за CONTEXT_WINDOW: только реплики
// пользователя, без LLM. Возвращает '' если сворачивать нечего.
function foldOverflowMessages(msgs: StoredMessage[]): string {
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
```

### 2. Подключение в processWithAI (~строки 705–710)
После вычисления `systemPrompt` и до сборки `loopMessages`:
```ts
const folded = foldOverflowMessages(threadMessages);
const fullSystemPrompt = folded
  ? `${systemPrompt}\n\n## Раньше сегодня (краткая сводка того, что пользователь говорил ранее в этот день — не переспрашивай это)\n${folded}`
  : systemPrompt;
```
И в вызове callRouterAI заменить `{ role: 'system', content: systemPrompt }` на `{ role: 'system', content: fullSystemPrompt }`. Если systemPrompt используется в нескольких итерациях tool-loop — заменить во всех местах внутри processWithAI (это одна переменная, переименование достаточно).

## Что НЕ делать
- Не менять CONTEXT_WINDOW, buildSafeHistory, toGroqFormat.
- Не включать в свёртку assistant/tool записи (JSON тул-коллов — мусор для промпта).
- Не вызывать LLM и не писать в БД.

## Крайние случаи
- Записей ≤ 50 → folded = '' → промпт байт-в-байт как раньше.
- Overflow есть, но в нём только assistant/tool записи → folded = '' → как раньше.
- Очень длинные реплики → усечение до 200 символов; блок целиком ≤ ~1500 символов.

## Проверка
1. `npx tsc --noEmit` — без ошибок.
2. Прогнать существующие тесты проекта (скрипт из package.json), новых падений нет.
3. Мини-проверка логики (можно временным скриптом, потом удалить): массив из 60 записей, где первые 10 — user с текстами «утро-1..10» → foldOverflowMessages возвращает блок с этими репликами; массив из 40 записей → ''.
