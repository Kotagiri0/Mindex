/**
 * server-bot.ts — Telegram-бот Mindex для Railway (Express + PostgreSQL).
 *
 * Регистрирует маршруты на Express-приложении и управляет webhook/long-polling.
 * Все данные хранятся в PostgreSQL (user_tasks, user_threads, user_profiles).
 * Telegram-пользователи сохраняются с префиксом tg_ в поле user_id.
 */

import type { Express } from 'express';
import type { Pool } from 'pg';
import axios from 'axios';
import Groq from 'groq-sdk';
import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TgUser { id: number; first_name: string; username?: string; }
interface TgMessage {
  message_id: number;
  from: TgUser;
  chat: { id: number };
  text?: string;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message: {
    chat: { id: number };
    message_id: number;
    reply_markup?: { inline_keyboard: any[][] };
  };
  data?: string;
}
interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_THREAD_TITLE = 'Telegram Bot';
const CONTEXT_WINDOW = 20;
const MAX_TOOL_ITERATIONS = 5;
const MAX_BUTTON_TEXT_LENGTH = 32;
const POLLING_ERROR_RETRY_DELAY_MS = 5_000;

// ─── System prompt ────────────────────────────────────────────────────────────

function getSystemInstruction(): string {
  return `Ты — ассистент по имени "Мысль". Помогай пользователю организовывать дела, превращая хаос мыслей в чёткие планы.
Отвечай на русском языке, лаконично и по делу. Ты работаешь в Telegram-боте — не используй Markdown-форматирование.

ПРАВИЛА ИНСТРУМЕНТОВ:
1. Если пользователь хочет добавить что-то новое — используй add_task.
2. Если спрашивает о задачах — используй get_tasks.
3. Если просит изменить, перенести или отметить задачу — используй update_task.
4. Если не знаешь ID задачи — сначала вызови get_tasks.

Сегодняшняя дата: ${new Date().toISOString().split('T')[0]}.`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const botTools: any[] = [
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'Получить список задач пользователя.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Дата YYYY-MM-DD. Если не указана — вернуть все задачи.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Добавить новую задачу.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название задачи.' },
          time: { type: 'string', description: 'Время HH:MM (необязательно).' },
          date: { type: 'string', description: 'Дата YYYY-MM-DD. По умолчанию — сегодня.' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Обновить задачу (имя, время, дату, статус выполнения).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи.' },
          done: { type: 'boolean', description: 'Статус выполнения.' },
          name: { type: 'string', description: 'Новое название.' },
          time: { type: 'string', description: 'Новое время HH:MM.' },
          date: { type: 'string', description: 'Новая дата YYYY-MM-DD.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Удалить задачу.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи.' }
        },
        required: ['id']
      }
    }
  }
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, args: any, db: Pool, userId: string): Promise<any> {
  const today = new Date().toISOString().split('T')[0];

  switch (name) {
    case 'get_tasks': {
      let query = `SELECT id, name, time, date, done, type FROM user_tasks WHERE user_id = $1`;
      const params: any[] = [userId];
      if (args.date) {
        query += ` AND date = $2`;
        params.push(args.date);
      }
      query += ` ORDER BY date ASC, time ASC NULLS LAST`;
      const { rows } = await db.query(query, params);
      return rows;
    }
    case 'add_task': {
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, 'regular', '[]'::jsonb, NOW(), NOW())`,
        [id, userId, String(args.name), String(args.time || ''), String(args.date || today)]
      );
      return { success: true, id };
    }
    case 'update_task': {
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (args.done !== undefined) { updates.push(`done = $${idx++}`); params.push(Boolean(args.done)); }
      if (args.name) { updates.push(`name = $${idx++}`); params.push(String(args.name)); }
      if (args.time !== undefined) { updates.push(`time = $${idx++}`); params.push(String(args.time || '')); }
      if (args.date) { updates.push(`date = $${idx++}`); params.push(String(args.date)); }
      if (updates.length === 0) return { error: 'Нет полей для обновления' };
      updates.push(`updated_at = NOW()`);
      params.push(String(args.id), userId);
      await db.query(
        `UPDATE user_tasks SET ${updates.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`,
        params
      );
      return { success: true };
    }
    case 'delete_task': {
      await db.query(
        `DELETE FROM user_tasks WHERE id = $1 AND user_id = $2`,
        [String(args.id), userId]
      );
      return { success: true };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// ─── AI processing with tool loop ────────────────────────────────────────────

function toGroqFormat(msgs: StoredMessage[]) {
  return msgs.map(m => {
    const msg: any = { role: m.role, content: typeof m.content === 'string' ? m.content : '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    return msg;
  });
}

function buildSafeHistory(msgs: StoredMessage[]): any[] {
  const raw = toGroqFormat(msgs.slice(-CONTEXT_WINDOW));
  const safe: any[] = [];
  let i = 0;
  while (i < raw.length) {
    const m = raw[i];
    if (m.role === 'assistant' && m.tool_calls?.length > 0) {
      const toolIds: string[] = m.tool_calls.map((tc: any) => tc.id);
      const following = raw.slice(i + 1, i + 1 + toolIds.length);
      const allPresent = toolIds.every((id: string) =>
        following.some((f: any) => f.role === 'tool' && f.tool_call_id === id)
      );
      if (!allPresent) { i++; continue; }
      safe.push(m);
      for (let j = 0; j < toolIds.length; j++) safe.push(raw[i + 1 + j]);
      i += 1 + toolIds.length;
    } else if (m.role === 'tool') {
      const prev = safe[safe.length - 1];
      if (!prev || prev.role !== 'assistant' || !prev.tool_calls?.length) { i++; continue; }
      safe.push(m);
      i++;
    } else {
      safe.push(m);
      i++;
    }
  }
  return safe;
}

async function processWithAI(
  userText: string,
  threadMessages: StoredMessage[],
  db: Pool,
  userId: string,
  groq: Groq
): Promise<{ aiResponse: string; newMessages: StoredMessage[] }> {
  const now = () => new Date().toISOString();
  const userMsg: StoredMessage = { role: 'user', content: userText, time: now() };

  const loopMessages = [
    ...buildSafeHistory(threadMessages),
    { role: 'user' as const, content: userText }
  ];
  const newMessages: StoredMessage[] = [userMsg];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: getSystemInstruction() }, ...loopMessages],
      tools: botTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1024
    });

    const msg = completion.choices[0].message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const assistantEntry: StoredMessage = {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        time: now(),
        tool_calls: msg.tool_calls
      };
      loopMessages.push({
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        tool_calls: msg.tool_calls
      });
      newMessages.push(assistantEntry);

      for (const toolCall of msg.tool_calls) {
        let args: any = {};
        try {
          args = JSON.parse(toolCall.function.arguments ?? '{}');
        } catch {
          const errStr = JSON.stringify({ error: 'Invalid JSON in tool arguments' });
          const toolEntry: StoredMessage = { role: 'tool', content: errStr, time: now(), tool_call_id: toolCall.id };
          loopMessages.push({ role: 'tool', content: errStr, tool_call_id: toolCall.id });
          newMessages.push(toolEntry);
          continue;
        }
        const result = await executeTool(toolCall.function.name, args, db, userId);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        const toolEntry: StoredMessage = {
          role: 'tool',
          content: resultStr,
          time: now(),
          tool_call_id: toolCall.id
        };
        loopMessages.push({ role: 'tool', content: resultStr, tool_call_id: toolCall.id });
        newMessages.push(toolEntry);
      }
    } else {
      const text = typeof msg.content === 'string' && msg.content
        ? msg.content
        : 'Не могу ответить прямо сейчас.';
      newMessages.push({ role: 'assistant', content: text, time: now() });
      return { aiResponse: text, newMessages };
    }
  }

  return { aiResponse: 'Не удалось обработать запрос.', newMessages };
}

// ─── Thread management (PostgreSQL) ──────────────────────────────────────────

async function loadBotThread(db: Pool, userId: string): Promise<{ id: string; messages: StoredMessage[] } | null> {
  const { rows } = await db.query(
    `SELECT id, messages FROM user_threads WHERE user_id = $1 AND title = $2 LIMIT 1`,
    [userId, BOT_THREAD_TITLE]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, messages: rows[0].messages ?? [] };
}

async function saveBotThread(
  db: Pool,
  userId: string,
  threadId: string | null,
  allMessages: StoredMessage[]
): Promise<void> {
  const preview = allMessages
    .filter(m => m.role !== 'tool')
    .slice(-1)[0]?.content?.slice(0, 80) ?? '';

  if (threadId) {
    await db.query(
      `UPDATE user_threads SET messages = $1::jsonb, preview = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(allMessages), preview, threadId]
    );
  } else {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), 'telegram')`,
      [id, userId, BOT_THREAD_TITLE, preview, JSON.stringify(allMessages), Date.now()]
    );
  }
}

// ─── Profile registration ─────────────────────────────────────────────────────

async function ensureProfile(db: Pool, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO user_profiles (user_id, settings, onboarding_complete, updated_at)
     VALUES ($1, '{"agent":true,"confirm":true,"notifs":true}'::jsonb, true, NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// ─── Telegram API helper ──────────────────────────────────────────────────────

async function tgApi(token: string, method: string, body: any): Promise<any> {
  return axios.post(`https://api.telegram.org/bot${token}/${method}`, body);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleStart(
  token: string,
  chatId: number,
  firstName: string,
  db: Pool,
  userId: string
): Promise<void> {
  await ensureProfile(db, userId);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Привет, ${escapeHtml(firstName)}! Я Мысль — твой персональный помощник по планированию.\n\nПросто напиши что думаешь, и я помогу разобраться с задачами. Например:\n"Встреча с командой завтра в 10"\n"Что у меня на сегодня?"\n\n/tasks — задачи на сегодня\n/help — список команд`
  });
}

async function handleHelp(token: string, chatId: number): Promise<void> {
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Доступные команды:\n\n/tasks — показать задачи на сегодня\n/help — эта справка\n\nЛибо просто напиши мне что угодно — добавить задачу, узнать план на завтра, переспросить что-то важное.`
  });
}

async function handleTasks(token: string, chatId: number, db: Pool, userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { rows: tasks } = await db.query(
    `SELECT id, name, time FROM user_tasks
     WHERE user_id = $1 AND date = $2 AND done = false
     ORDER BY time ASC NULLS LAST`,
    [userId, today]
  );

  if (tasks.length === 0) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: '✨ На сегодня задач нет.' });
    return;
  }

  const lines = tasks.map((t: any, i: number) => {
    const time = t.time ? ` — <b>${escapeHtml(t.time)}</b>` : '';
    return `${i + 1}. <b>${escapeHtml(t.name)}</b>${time}`;
  }).join('\n');

  const inline_keyboard = tasks.map((t: any) => {
    const label = t.name.length > MAX_BUTTON_TEXT_LENGTH
      ? `✓ ${t.name.slice(0, MAX_BUTTON_TEXT_LENGTH - 1)}…`
      : `✓ ${t.name}`;
    return [{ text: label, callback_data: `done:${t.id}` }];
  });

  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `📋 <b>Задачи на сегодня:</b>\n\n${lines}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });
}

async function handleCallback(cq: TgCallbackQuery, token: string, db: Pool): Promise<void> {
  if (!cq.data?.startsWith('done:')) {
    await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  const taskId = cq.data.slice(5);
  const userId = `tg_${cq.from.id}`;
  await db.query(
    `UPDATE user_tasks SET done = true, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [taskId, userId]
  );

  await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Выполнено!' });

  // Убираем кнопку выполненной задачи из сообщения
  const origKeyboard = cq.message.reply_markup?.inline_keyboard ?? [];
  const newKeyboard = origKeyboard.filter(row =>
    !row.some((btn: any) => btn.callback_data === cq.data)
  );
  await tgApi(token, 'editMessageReplyMarkup', {
    chat_id: cq.message.chat.id,
    message_id: cq.message.message_id,
    reply_markup: { inline_keyboard: newKeyboard }
  }).catch(() => {}); // игнорируем, если сообщение слишком старое
}

// ─── Обработка одного обновления ─────────────────────────────────────────────

async function processUpdate(update: any, token: string, db: Pool, groq: Groq): Promise<void> {
  // Inline keyboard callback
  if (update.callback_query) {
    await handleCallback(update.callback_query as TgCallbackQuery, token, db);
    return;
  }

  const message: TgMessage = update.message;
  if (!message?.from || !message.text) return;

  const tgUserId = message.from.id;
  const userId = `tg_${tgUserId}`;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === '/start') {
    await handleStart(token, chatId, message.from.first_name, db, userId);
    return;
  }

  if (text === '/help') {
    await handleHelp(token, chatId);
    return;
  }

  if (text === '/tasks') {
    await ensureProfile(db, userId);
    await handleTasks(token, chatId, db, userId);
    return;
  }

  // Все остальные сообщения → AI (Мысль)
  await ensureProfile(db, userId);

  const thread = await loadBotThread(db, userId);
  const existingMessages = thread?.messages ?? [];

  const { aiResponse, newMessages } = await processWithAI(
    text,
    existingMessages,
    db,
    userId,
    groq
  );

  await saveBotThread(db, userId, thread?.id ?? null, [...existingMessages, ...newMessages]);

  await tgApi(token, 'sendMessage', { chat_id: chatId, text: aiResponse });
}

// ─── Настройка вебхука ────────────────────────────────────────────────────────

async function setupWebhook(token: string, appUrl: string): Promise<void> {
  const webhookUrl = `${appUrl}/api/telegram`;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true
    });
    console.log(`[Bot] Webhook установлен: ${webhookUrl}`);
  } catch (e: any) {
    console.error('[Bot] Ошибка установки webhook:', e?.response?.data || e?.message);
  }
}

// ─── Long-polling для локальной разработки ────────────────────────────────────

async function startLongPolling(token: string, db: Pool, groq: Groq): Promise<void> {
  // Сначала удаляем webhook, чтобы можно было использовать getUpdates
  try {
    await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, { drop_pending_updates: true });
    console.log('[Bot] Webhook удалён, запускаем long-polling');
  } catch (e: any) {
    console.warn('[Bot] Не удалось удалить webhook:', e?.message);
  }

  let offset = 0;

  const poll = async (): Promise<void> => {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
        timeout: 35_000
      });
      const updates: any[] = res.data?.result ?? [];
      for (const update of updates) {
        offset = update.update_id + 1;
        processUpdate(update, token, db, groq).catch(e =>
          console.error('[Bot] Ошибка обработки обновления:', e)
        );
      }
    } catch (e: any) {
      if (e?.code !== 'ECONNABORTED') {
        console.error('[Bot] Ошибка polling:', e?.message || e);
        await new Promise(r => setTimeout(r, POLLING_ERROR_RETRY_DELAY_MS));
      }
    }
    setImmediate(poll);
  };

  poll();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Регистрирует маршрут вебхука POST /api/telegram на Express-приложении.
 * Вызывается при инициализации сервера.
 */
export function registerBotRoutes(app: Express, db: Pool): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Bot] TELEGRAM_BOT_TOKEN не установлен — бот отключён');
    return;
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.warn('[Bot] GROQ_API_KEY не установлен — бот отключён');
    return;
  }

  const groq = new Groq({ apiKey: groqKey });

  // Вебхук эндпоинт
  app.post('/api/telegram', (req, res) => {
    // Отвечаем немедленно, обработку делаем асинхронно
    res.status(200).end();
    processUpdate(req.body, token, db, groq).catch(e =>
      console.error('[Bot] Ошибка вебхука:', e)
    );
  });

  console.log('[Bot] Маршруты зарегистрированы: POST /api/telegram');
}

/**
 * Запускает бота: устанавливает webhook на Railway или long-polling локально.
 * Вызывается после запуска HTTP-сервера.
 */
export async function startBot(db: Pool): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return;

  const groq = new Groq({ apiKey: groqKey });

  // Определяем URL приложения (Railway или кастомный)
  const appUrl =
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);

  if (appUrl) {
    await setupWebhook(token, appUrl);
  } else {
    console.log('[Bot] APP_URL не задан — запускаем long-polling');
    startLongPolling(token, db, groq);
  }
}
