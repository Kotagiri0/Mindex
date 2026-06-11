# План: sweep-саммаризация остывших тредов (ПОЛИСАД, шаг 1)

> Исполнитель: Sonnet 4.6. Следуй плану дословно. Если что-то в коде противоречит плану — остановись и спроси, не импровизируй.
> Прод с живыми данными: никаких DROP/DELETE, миграции только ADD COLUMN IF NOT EXISTS.

## Проблема
Summary создаётся только когда клиент дёргает `/api/summarize` (закрытие треда) или когда бот создаёт новый дневной тред. Незакрытые треды и пропущенные дни навсегда остаются без summary → выпадают из RAG → «агент не помнит вчерашний разговор».

## Решение
Серверный sweep в `server.ts`: раз в 10 минут находит «остывшие» треды без summary и саммаризирует их той же логикой, что `/api/summarize`.

## Изменения — только в `server.ts` (бот не трогать)

### 1. Миграция (рядом с остальными ALTER TABLE, ~строка 552)
```sql
ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS summary_attempted_at TIMESTAMPTZ;
```

### 2. Рефакторинг: извлечь ядро `/api/summarize` в функцию
Сейчас логика живёт внутри `app.post("/api/summarize", ...)` (~строки 1809–1931). Извлечь в функцию, эндпоинт переписать как тонкую обёртку над ней (поведение эндпоинта не менять ни в чём, включая ответы об ошибках):

```ts
async function summarizeThreadCore(
  threadId: string,
  userId: string,
  messages: any[],
  apiKey: string
): Promise<{ summary: string; isMeaningful: boolean } | null>
```
Внутрь уходит: построение dialogText, вызов callRouterAI (та же модель, тот же промпт, те же параметры), парсинг JSON, UPDATE user_threads, генерация эмбеддинга. Возврат null при ошибке RouterAI.

### 3. Sweep
```ts
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_COLD_MINUTES = 30;   // тред «остыл» после 30 мин тишины
const SWEEP_BATCH = 10;          // максимум тредов за проход (плавный backfill истории)
const SWEEP_RETRY_HOURS = 6;     // повторная попытка после неудачи

async function sweepColdThreads(): Promise<void> {
  if (!db) return;
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return;

  const { rows } = await db.query(`
    SELECT id, user_id, messages FROM user_threads
    WHERE summary IS NULL
      AND is_meaningful IS DISTINCT FROM false
      AND source IS DISTINCT FROM 'заметка'      -- заметки: 1 сообщение, пустой summary легален; sweep пометил бы их false и скрыл из памяти бота
      AND label IS DISTINCT FROM 'profile'       -- профильные треды никогда не помечать false
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
      await summarizeThreadCore(row.id, row.user_id, messages, apiKey);
    } catch (e: any) {
      console.warn('[polisad/sweep]', row.id, e?.message);
    }
  }
}

setInterval(() => { sweepColdThreads().catch(e => console.warn('[polisad/sweep]', e?.message)); }, SWEEP_INTERVAL_MS);
console.log('[polisad] sweep запущен: каждые 10 мин, остывание 30 мин, батч 10');
```
Разместить рядом с другими фоновыми задачами / после инициализации db. setInterval запускать только если db доступна.

## Что НЕ делать
- Не менять `server-bot.ts` (его триггер остаётся как ранний путь; sweep подстрахует и его треды через общую таблицу).
- Не менять промпт, модель и параметры саммаризации.
- Не трогать `updated_at` в sweep — это сигнал активности пользователя, для попыток есть `summary_attempted_at`.
- Не саммаризировать треды-заметки отдельно (они получают summary при сохранении; если у заметки нет summary — sweep обработает её как обычный тред, это ок).

## Крайние случаи (проверить, что обработаны)
- `messages` = null / не массив → userMsgCount = 0 → is_meaningful = false.
- RouterAI недоступен → summarizeThreadCore вернул null → summary останется NULL, `summary_attempted_at` поставлен → ретрай через 6 часов.
- Тред, в который пользователь вернулся (updated_at обновился) → снова считается «горячим», подождёт остывания.
- Двойной запуск инстансов server.ts: `summary_attempted_at` ставится до вызова LLM — гонка возможна, но в худшем случае двойная саммаризация одного треда (идемпотентно, приемлемо).

## Проверка
1. `npx tsc --noEmit` — без ошибок.
2. Существующие тесты `tests/unit/api/summarize.test.ts` проходят (эндпоинт не изменил поведение).
3. Локально: создать тред с 2+ user-сообщениями без summary, выставить updated_at на час назад, дождаться/вызвать sweep → summary появился, is_meaningful выставлен.
