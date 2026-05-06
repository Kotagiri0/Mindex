/**
 * Telegram Bot — Express integration for Railway / Node.js deployments.
 * Uses the existing pg Pool (user_tasks, user_threads, user_profiles tables).
 * Telegram users are stored with user_id prefix "tg_<telegramId>" to avoid
 * collisions with app accounts.
 */

import type { Application, Request, Response } from 'express';
import type { Pool } from 'pg';
import axios from 'axios';
import Groq from 'groq-sdk';
import crypto from 'crypto';
import { BOT_COMMANDS } from './api/bot-commands.js';

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

// ─── System prompt ────────────────────────────────────────────────────────────

function getSystemInstruction() {
  return `Ты — ассистент по имени "Мысль". Помогай пользователю организовывать дела, превращая хаос мыслей в чёткие планы.
Отвечай на русском языке, лаконично и по делу. Ты работаешь в Telegram-боте — не используй Markdown-форматирование.

ПРАВИЛА ИНСТРУМЕНТОВ:
1. Если пользователь хочет добавить что-то новое — используй add_task.
2. Если спрашивает о задачах — используй get_tasks.
3. Если просит изменить, перенести или отметить задачу — используй update_task.
4. Если не знаешь ID задачи — сначала вызови get_tasks.

Сегодняшняя дата: ${new Date().toISOString().split('T')[0]}.`;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

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
          id:   { type: 'string',  description: 'ID задачи.' },
          done: { type: 'boolean', description: 'Статус выполнения.' },
          name: { type: 'string',  description: 'Новое название.' },
          time: { type: 'string',  description: 'Новое время HH:MM.' },
          date: { type: 'string',  description: 'Новая дата YYYY-MM-DD.' }
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

// ─── DB helpers (pg) ──────────────────────────────────────────────────────────

async function ensureProfile(db: Pool, userId: string) {
  await db.query(
    `INSERT INTO user_profiles (user_id, settings, onboarding_complete)
     VALUES ($1, '{"agent":true,"confirm":true,"notifs":true}', true)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function loadBotThread(db: Pool, userId: string) {
  const { rows } = await db.query(
    'SELECT id, messages FROM user_threads WHERE user_id = $1 AND title = $2 LIMIT 1',
    [userId, BOT_THREAD_TITLE]
  );
  if (!rows.length) return null;
  return { id: rows[0].id as string, messages: rows[0].messages as StoredMessage[] };
}

async function saveBotThread(
  db: Pool,
  userId: string,
  threadId: string | null,
  allMessages: StoredMessage[]
) {
  const preview = allMessages
    .filter(m => m.role !== 'tool')
    .slice(-1)[0]?.content?.slice(0, 80) ?? '';

  if (threadId) {
    await db.query(
      'UPDATE user_threads SET messages = $1::jsonb, preview = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(allMessages), preview, threadId]
    );
  } else {
    await db.query(
      `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), 'telegram')`,
      [crypto.randomUUID(), userId, BOT_THREAD_TITLE, preview, JSON.stringify(allMessages), Date.now()]
    );
  }
}

async function executeTool(name: string, args: any, db: Pool, userId: string): Promise<any> {
  const today = new Date().toISOString().split('T')[0];

  switch (name) {
    case 'get_tasks': {
      const params: any[] = [userId];
      let q = 'SELECT id, name, time, date, done, type FROM user_tasks WHERE user_id = $1';
      if (args.date) { q += ' AND date = $2'; params.push(args.date); }
      q += ' ORDER BY created_at DESC';
      const { rows } = await db.query(q, params);
      return rows;
    }
    case 'add_task': {
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type)
         VALUES ($1, $2, $3, $4, $5, false, 'regular')`,
        [id, userId, args.name, args.time ?? '', args.date ?? today]
      );
      return { success: true, id };
    }
    case 'update_task': {
      const sets: string[] = [];
      const params: any[] = [];
      if (args.done !== undefined) { params.push(args.done); sets.push(`done = $${params.length}`); }
      if (args.name)  { params.push(args.name);  sets.push(`name = $${params.length}`); }
      if (args.time)  { params.push(args.time);  sets.push(`time = $${params.length}`); }
      if (args.date)  { params.push(args.date);  sets.push(`date = $${params.length}`); }
      if (!sets.length) return { error: 'Нечего обновлять' };
      sets.push(`updated_at = NOW()`);
      params.push(args.id, userId);
      await db.query(
        `UPDATE user_tasks SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
        params
      );
      return { success: true };
    }
    case 'delete_task': {
      await db.query('DELETE FROM user_tasks WHERE id = $1 AND user_id = $2', [args.id, userId]);
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
      loopMessages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '', tool_calls: msg.tool_calls });
      newMessages.push(assistantEntry);

      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments ?? '{}');
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
      const text = typeof msg.content === 'string' && msg.content ? msg.content : 'Не могу ответить прямо сейчас.';
      newMessages.push({ role: 'assistant', content: text, time: now() });
      return { aiResponse: text, newMessages };
    }
  }

  return { aiResponse: 'Не удалось обработать запрос.', newMessages };
}

// ─── Telegram API helper ──────────────────────────────────────────────────────

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tgApi(token: string, method: string, body: any) {
  return axios.post(`https://api.telegram.org/bot${token}/${method}`, body);
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleStart(token: string, chatId: number, firstName: string, db: Pool, userId: string) {
  await ensureProfile(db, userId);
  const miniAppUrl = process.env.MINI_APP_URL;
  const reply_markup = miniAppUrl
    ? { inline_keyboard: [[{ text: '📱 Открыть Mindex', web_app: { url: miniAppUrl } }]] }
    : undefined;
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Привет, ${firstName}! Я Мысль — твой персональный помощник по планированию.\n\nПросто напиши что думаешь, и я помогу разобраться с задачами. Например:\n"Встреча с командой завтра в 10"\n"Что у меня на сегодня?"\n\n/tasks — задачи на сегодня\n/help — все команды`,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

async function handleHelp(token: string, chatId: number) {
  const lines = BOT_COMMANDS.map(c => `/${c.command} — ${c.description}`).join('\n');
  await tgApi(token, 'sendMessage', { chat_id: chatId, text: `📋 Доступные команды:\n\n${lines}` });
}

async function handleTasks(token: string, chatId: number, db: Pool, userId: string) {
  const today = new Date().toISOString().split('T')[0];
  const { rows: tasks } = await db.query(
    `SELECT id, name, time FROM user_tasks
     WHERE user_id = $1 AND date = $2 AND done = false
     ORDER BY NULLIF(time, '') ASC NULLS LAST`,
    [userId, today]
  );

  if (!tasks.length) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: '✨ На сегодня задач нет.' });
    return;
  }

  const lines = tasks.map((t: any, i: number) => {
    const time = t.time ? ` — <b>${escapeHtml(t.time)}</b>` : '';
    return `${i + 1}. <b>${escapeHtml(t.name)}</b>${time}`;
  }).join('\n');

  const inline_keyboard = tasks.map((t: any) => ([{
    text: `✓ ${String(t.name).slice(0, 32)}`,
    callback_data: `done:${t.id}`
  }]));

  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `📋 <b>Задачи на сегодня:</b>\n\n${lines}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });
}

async function handleClear(token: string, chatId: number, db: Pool, userId: string) {
  try {
    await db.query(
      'DELETE FROM user_threads WHERE user_id = $1 AND title = $2',
      [userId, BOT_THREAD_TITLE]
    );
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: '🗑 История диалога очищена.' });
  } catch {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Не удалось очистить историю. Попробуй ещё раз.' });
  }
}

async function handleApp(token: string, chatId: number) {
  const miniAppUrl = process.env.MINI_APP_URL;
  if (!miniAppUrl) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Веб-версия временно недоступна. Используй команды бота.' });
    return;
  }
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: 'Открываю Mindex 👇',
    reply_markup: { inline_keyboard: [[{ text: '📱 Открыть Mindex', web_app: { url: miniAppUrl } }]] },
  });
}

async function handleCallback(cq: TgCallbackQuery, token: string, db: Pool) {
  if (!cq.data?.startsWith('done:')) {
    await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  const taskId = cq.data.slice(5);
  const userId = `tg_${cq.from.id}`;
  await db.query(
    'UPDATE user_tasks SET done = true, updated_at = NOW() WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );

  await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Выполнено!' });

  const origKeyboard = cq.message.reply_markup?.inline_keyboard ?? [];
  const newKeyboard = origKeyboard.filter(row =>
    !row.some((btn: any) => btn.callback_data === cq.data)
  );
  await tgApi(token, 'editMessageReplyMarkup', {
    chat_id: cq.message.chat.id,
    message_id: cq.message.message_id,
    reply_markup: { inline_keyboard: newKeyboard }
  }).catch(() => {});
}

// ─── Long-polling (local dev) ─────────────────────────────────────────────────

async function processUpdate(update: any, token: string, db: Pool, groq: Groq) {
  if (update.callback_query) {
    await handleCallback(update.callback_query as TgCallbackQuery, token, db);
    return;
  }

  const message: TgMessage = update.message;
  if (!message?.from || !message.text) return;

  const { id: telegramId, first_name } = message.from;
  const chatId = message.chat.id;
  const text = message.text;
  const userId = `tg_${telegramId}`;
  const groqKey = process.env.GROQ_API_KEY;

  try {
    if (text === '/start') { await handleStart(token, chatId, first_name, db, userId); return; }
    if (text === '/help')  { await handleHelp(token, chatId); return; }
    if (text === '/tasks') { await ensureProfile(db, userId); await handleTasks(token, chatId, db, userId); return; }
    if (text === '/clear') { await ensureProfile(db, userId); await handleClear(token, chatId, db, userId); return; }
    if (text === '/app')   { await handleApp(token, chatId); return; }

    if (text.startsWith('/add')) {
      await ensureProfile(db, userId);
      const taskName = text.startsWith('/add ') ? text.slice(5).trim() : '';
      if (!taskName) {
        await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Напиши название задачи после /add' });
        return;
      }
      const today = new Date().toISOString().split('T')[0];
      const id = crypto.randomUUID();
      const { rowCount } = await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type) VALUES ($1, $2, $3, '', $4, false, 'regular')`,
        [id, userId, taskName, today]
      );
      if (!rowCount) {
        await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Не удалось добавить задачу. Попробуй ещё раз.' });
        return;
      }
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: `✅ Задача добавлена: ${taskName}` });
      return;
    }

    if (!groqKey) {
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'GROQ_API_KEY не задан.' });
      return;
    }

    await ensureProfile(db, userId);
    const thread = await loadBotThread(db, userId);
    const existingMessages = thread?.messages ?? [];
    const { aiResponse, newMessages } = await processWithAI(text, existingMessages, db, userId, groq);
    await saveBotThread(db, userId, thread?.id ?? null, [...existingMessages, ...newMessages]);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: aiResponse });
  } catch (e) {
    console.error(`[Bot] Error processing message from ${userId}:`, e);
    tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Что-то пошло не так. Попробуй ещё раз.' }).catch(() => {});
  }
}

async function startPolling(token: string, db: Pool, groq: Groq) {
  // Clear any existing webhook so polling can work
  try {
    await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`, { drop_pending_updates: true });
    console.log('[Bot] Polling mode: webhook cleared, starting long-poll loop...');
  } catch {
    console.warn('[Bot] Could not clear webhook — polling may not receive updates if a webhook is set.');
  }

  let offset = 0;
  const poll = async () => {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
        timeout: 40_000,
      });
      const updates: any[] = res.data.result ?? [];
      for (const upd of updates) {
        offset = upd.update_id + 1;
        processUpdate(upd, token, db, groq).catch(e =>
          console.error(`[Bot] Update error (ID: ${upd.update_id}):`, e)
        );
      }
    } catch (e: any) {
      const isTimeout = axios.isAxiosError(e) && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT');
      if (!isTimeout) {
        console.error('[Bot] Poll error:', e.message);
        await new Promise(r => setTimeout(r, 5_000));
      }
    }
    setImmediate(poll);
  };

  poll();
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerBotRoutes(app: Application, db: Pool): void {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const groqKey = process.env.GROQ_API_KEY;

  if (!BOT_TOKEN) {
    console.log('[Bot] TELEGRAM_BOT_TOKEN not set — bot routes skipped.');
    return;
  }

  const groq = new Groq({ apiKey: groqKey ?? '' });

  // Auto-start polling when running locally (no public URL configured)
  const isLocal = !process.env.APP_URL && !process.env.RAILWAY_PUBLIC_DOMAIN;
  if (isLocal) {
    console.log('[Bot] No APP_URL/RAILWAY_PUBLIC_DOMAIN detected — starting long-poll mode for local dev.');
    startPolling(BOT_TOKEN, db, groq);
  }

  // ── Webhook handler ────────────────────────────────────────────────────────
  app.post('/api/telegram', (req: Request, res: Response) => {
    // Respond immediately — Telegram retries if it doesn't receive 200 within ~10s.
    // All processing happens asynchronously below.
    res.status(200).end();
    processUpdate(req.body, BOT_TOKEN, db, groq).catch(e =>
      console.error('[Bot] Webhook handler error:', e)
    );
  });

  // ── Setup endpoint ─────────────────────────────────────────────────────────
  app.get('/api/setup-bot', async (req: Request, res: Response) => {
    // Determine public URL: manual APP_URL → Railway domain → request host
    const appUrl =
      process.env.APP_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `${req.protocol}://${req.get('host')}`);

    const webhookUrl = `${appUrl}/api/telegram`;

    try {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        url: webhookUrl,
        drop_pending_updates: true,
      });

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
        commands: BOT_COMMANDS,
      });

      const infoRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);

      console.log(`[Bot] Webhook set to: ${webhookUrl}`);
      res.json({ success: true, message: 'Бот успешно настроен!', webhookUrl, info: infoRes.data.result });
    } catch (error: any) {
      console.error('[Bot] Setup error:', error.response?.data || error.message);
      res.status(500).json({ success: false, error: error.response?.data?.description || error.message });
    }
  });

  console.log('[Bot] Routes registered: POST /api/telegram, GET /api/setup-bot');
}
