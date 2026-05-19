/**
 * server-bot.ts — Telegram-бот Mindex для Railway (Express + PostgreSQL).
 *
 * Регистрирует маршруты на Express-приложении и управляет webhook/long-polling.
 * Все данные хранятся в PostgreSQL (user_tasks, user_threads, user_profiles).
 * Telegram-пользователи сохраняются с префиксом tg_ в поле user_id.
 */

import type { Express } from 'express';
import type { Pool } from 'pg';
import crypto from 'crypto';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrlGlobal = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrlGlobal) {
  setGlobalDispatcher(new ProxyAgent(proxyUrlGlobal));
  console.log('[Bot] Прокси установлен:', proxyUrlGlobal.replace(/:([^@]+)@/, ':***@'));
}

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

function tgFetchOptions(extra: RequestInit = {}): RequestInit {
  return extra;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_THREAD_TITLE = 'Telegram Bot';
const CONTEXT_WINDOW = 20;
const MAX_TOOL_ITERATIONS = 5;
const MAX_BUTTON_TEXT_LENGTH = 32;
const POLLING_ERROR_RETRY_DELAY_MS = 5_000;

// ─── System prompt ────────────────────────────────────────────────────────────

function getSystemInstruction(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Moscow' });
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

  return `Ты — Мысль, личный ассистент по организации дел и мышлению.

Отвечай только на русском. Никогда не используй эмодзи, звёздочки, Markdown-форматирование. Только чистый текст.

ХАРАКТЕР
Говори как умный человек, а не как сервис. Коротко, прямо, без воды. Человечно — но без слащавости и дежурных фраз. Если можно ответить одним словом — ответь одним словом.

Точки в конце: ставь точку только когда она реально нужна — в конце длинного абзаца или сложного предложения. Короткие ответы, реплики, перечисления, вопросы — без точки в конце. Чувствуй ритм текста

Никогда не начинай ответ с "Конечно!", "Отлично!", "Понял!", "Вот:", "Хорошо!" и любых других вводных. Сразу к делу

ГЛАВНЫЕ ПРАВИЛА
— Меньше слов = лучше. Каждое слово должно нести смысл
— Если чего-то не знаешь или не можешь — говори прямо. Не придумывай
— Задавай уточняющие вопросы когда контекст неполный. Один вопрос за раз, не анкету
— Учитывай всё что пользователь говорил раньше в диалоге
— Если пришёл сырой brain dump — сначала структурируй, потом уточняй детали
— Никогда не говори "у меня нет доступа к этой информации" про свои собственные возможности

ИНСТРУМЕНТЫ
— add_task: когда пользователь хочет добавить новую задачу
— get_tasks: когда спрашивает о планах или задачах
— update_task: когда нужно изменить, перенести или дополнить задачу. Если не знаешь ID — сначала get_tasks
— delete_task: когда нужно удалить задачу
— get_notes: когда пользователь спрашивает о заметках, просит найти что-то в заметках
— create_note: когда пользователь просит сохранить что-то как заметку

Текущие дата и время: ${dateStr}, ${timeStr} (Москва)`;
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
  },
  {
    type: 'function',
    function: {
      name: 'get_notes',
      description: 'Получить список заметок пользователя.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос (необязательно). Если указан — фильтрует по заголовку или содержимому.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Создать новую заметку.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Заголовок заметки.' },
          content: { type: 'string', description: 'Содержимое заметки.' }
        },
        required: ['title', 'content']
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
    case 'get_notes': {
      let query = `SELECT id, title, summary, messages, preview, created_at FROM user_threads WHERE user_id = $1 AND source = 'заметка' AND is_meaningful IS NOT FALSE`;
      const params: any[] = [userId];
      if (args.query) {
        query += ` AND (title ILIKE $2 OR summary ILIKE $2 OR preview ILIKE $2)`;
        params.push(`%${args.query}%`);
      }
      query += ` ORDER BY updated_at DESC LIMIT 10`;
      const { rows } = await db.query(query, params);
      return rows.map((r: any) => {
        // summary заполняется через /api/summarize, может быть пустым
        // fallback: берём текст из последнего сообщения в messages
        let content = r.summary || '';
        if (!content && Array.isArray(r.messages) && r.messages.length > 0) {
          const last = r.messages.filter((m: any) => m.role === 'user' || m.role === 'assistant').slice(-1)[0];
          content = last?.content || r.preview || '';
        }
        return { id: r.id, title: r.title, content };
      });
    }
    case 'create_note': {
      const id = crypto.randomUUID();
      const title = String(args.title);
      const content = String(args.content);
      await db.query(
        `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source, summary, is_meaningful)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, $6, NOW(), 'заметка', $5, true)`,
        [id, userId, title, content.slice(0, 100), content, Date.now()]
      );
      return { success: true, id, title };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// ─── AI processing with tool loop ────────────────────────────────────────────

const MAX_MSG_CHARS = 2000;

function toGroqFormat(msgs: StoredMessage[]) {
  return msgs.map(m => {
    let content = typeof m.content === 'string' ? m.content : '';
    if (content.length > MAX_MSG_CHARS) content = content.slice(0, MAX_MSG_CHARS) + '…';
    const msg: any = { role: m.role, content };
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

async function callRouterAI(apiKey: string, body: object): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://routerai.ru/api/v1/chat/completions', tgFetchOptions({
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }));
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`RouterAI error: ${response.status}`);
    return await response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function processWithAI(
  userText: string,
  threadMessages: StoredMessage[],
  db: Pool,
  userId: string,
  apiKey: string
): Promise<{ aiResponse: string; newMessages: StoredMessage[] }> {
  const now = () => new Date().toISOString();
  const userMsg: StoredMessage = { role: 'user', content: userText, time: now() };

  const loopMessages = [
    ...buildSafeHistory(threadMessages),
    { role: 'user' as const, content: userText }
  ];
  const newMessages: StoredMessage[] = [userMsg];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const data = await callRouterAI(apiKey, {
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'system', content: getSystemInstruction() }, ...loopMessages],
      tools: botTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1024,
      thinking: false,
    });

    const msg = data.choices[0].message;

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

// ─── Получить web userId по telegram chatId ───────────────────────────────────

async function getWebUserId(db: Pool, chatId: number): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT user_id FROM user_profiles WHERE telegram_chat_id = $1 LIMIT 1`,
    [chatId]
  );
  return rows[0]?.user_id ?? null;
}

// ─── Profile registration ─────────────────────────────────────────────────────

async function ensureProfile(db: Pool, userId: string, chatId?: number): Promise<void> {
  await db.query(
    `INSERT INTO user_profiles (user_id, settings, onboarding_complete, updated_at)
     VALUES ($1, '{"agent":true,"confirm":true,"notifs":true}'::jsonb, true, NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  if (chatId !== undefined) {
    await db.query(
      `UPDATE user_profiles SET telegram_chat_id = $1, updated_at = NOW() WHERE user_id = $2`,
      [chatId, userId]
    );
  }
}

// ─── Telegram API helper ──────────────────────────────────────────────────────

async function tgApi(token: string, method: string, body: any): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, tgFetchOptions({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return res.json();
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
  userId: string,
  linkCode?: string
): Promise<void> {
  // Привязка аккаунта по коду
  if (linkCode) {
    const { rows } = await db.query(
      `SELECT user_id FROM telegram_link_codes
       WHERE code = $1 AND used = FALSE AND expires_at > NOW()
       LIMIT 1`,
      [linkCode]
    );

    if (rows[0]) {
      const webUserId = rows[0].user_id;
      await db.query(
        `INSERT INTO user_profiles (user_id, telegram_chat_id, updated_at)
         VALUES ($2, $1, NOW())
         ON CONFLICT (user_id) DO UPDATE SET telegram_chat_id = $1, updated_at = NOW()`,
        [chatId, webUserId]
      );
      await db.query(
        `UPDATE telegram_link_codes SET used = TRUE WHERE code = $1`,
        [linkCode]
      );
      await tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Готово, ${escapeHtml(firstName)}! Telegram подключён к Mindex.\n\nТеперь я буду напоминать тебе о задачах прямо сюда, за 15 минут до начала.\n\n/tasks — задачи на сегодня\n/help — список команд`
      });
      return;
    } else {
      await tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text: `Код недействителен или уже использован. Вернись в приложение и нажми "Подключить Telegram" ещё раз.`
      });
      return;
    }
  }

  await ensureProfile(db, userId);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Привет, ${escapeHtml(firstName)}! Я Мысль — твой персональный помощник по планированию.\n\nЧтобы получать уведомления о задачах, подключи меня в настройках приложения Mindex.\n\nЕсли уже подключил — просто пиши:\n"Встреча с командой завтра в 10"\n"Что у меня на сегодня?"\n\n/tasks — задачи на сегодня\n/help — список команд`
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

async function processUpdate(update: any, token: string, db: Pool, apiKey: string): Promise<void> {
  // Inline keyboard callback
  if (update.callback_query) {
    await handleCallback(update.callback_query as TgCallbackQuery, token, db);
    return;
  }

  const message: TgMessage = update.message;
  if (!message?.from || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith('/start')) {
    const tgUserId = message.from.id;
    const tgUserfallbackId = `tg_${tgUserId}`;
    const parts = text.split(' ');
    const linkCode = parts[1]?.trim() || undefined;
    await handleStart(token, chatId, message.from.first_name, db, tgUserfallbackId, linkCode);
    return;
  }

  // Проверяем привязку — без неё общение закрыто
  console.log(`[Bot] сообщение от chatId=${chatId}, text="${text}"`);
  const webUserId = await getWebUserId(db, chatId);
  console.log(`[Bot] webUserId для chatId=${chatId}: ${webUserId}`);
  if (!webUserId) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: `Чтобы общаться со мной, сначала подключи Telegram в приложении Mindex.\n\nОткрой приложение → Настройки → Telegram → Подключить. Получишь код — введи его командой /start КОД`
    });
    return;
  }

  if (text === '/help') {
    await handleHelp(token, chatId);
    return;
  }

  if (text === '/tasks') {
    await handleTasks(token, chatId, db, webUserId);
    return;
  }

  // Все остальные сообщения → AI (Мысль) — используем webUserId для доступа к данным
  const thread = await loadBotThread(db, webUserId);
  const existingMessages = thread?.messages ?? [];

  console.log(`[Bot] вызываю AI для ${webUserId}, сообщение: "${text}"`);
  try {
    const { aiResponse, newMessages } = await processWithAI(
      text,
      existingMessages,
      db,
      webUserId,
      apiKey
    );
    console.log(`[Bot] AI ответил: "${aiResponse?.slice(0, 80)}"`);
    await saveBotThread(db, webUserId, thread?.id ?? null, [...existingMessages, ...newMessages]);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: aiResponse });
  } catch (e: any) {
    console.error(`[Bot] ошибка AI:`, e?.message || e);
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Не могу ответить прямо сейчас, попробуй позже.' });
  }
}

// ─── Token validation ─────────────────────────────────────────────────────────

async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, tgFetchOptions({ signal: AbortSignal.timeout(10_000) }));
    if (res.status === 401 || res.status === 404) {
      console.error('[Bot] Неверный токен TELEGRAM_BOT_TOKEN — проверь значение в .env и перезапусти сервер.');
      return false;
    }
    const data = await res.json() as any;
    const bot = data?.result;
    console.log(`[Bot] Токен действителен. Бот: @${bot?.username} (id=${bot?.id})`);
    return true;
  } catch (e: any) {
    // Сетевая ошибка — считаем токен действительным, попробуем в polling/webhook
    console.warn('[Bot] Не удалось проверить токен (сетевая ошибка), продолжаем запуск:', e?.message);
    return true;
  }
}

// ─── Настройка вебхука ────────────────────────────────────────────────────────

async function setupWebhook(token: string, appUrl: string): Promise<void> {
  const webhookUrl = `${appUrl}/api/telegram`;
  try {
    await fetch(`https://api.telegram.org/bot${token}/setWebhook`, tgFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }),
    }));
    console.log(`[Bot] Webhook установлен: ${webhookUrl}`);
  } catch (e: any) {
    console.error('[Bot] Ошибка установки webhook:', e?.message);
  }
}

// ─── Long-polling для локальной разработки ────────────────────────────────────

async function startLongPolling(token: string, db: Pool, apiKey: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, tgFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
    }));
    console.log('[Bot] Webhook удалён, запускаем long-polling');
  } catch (e: any) {
    console.warn('[Bot] Не удалось удалить webhook:', e?.message);
  }

  let offset = 0;
  let running = true;

  const poll = async (): Promise<void> => {
    if (!running) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35_000);
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message","callback_query"]`,
        tgFetchOptions({ signal: controller.signal })
      );
      clearTimeout(timeoutId);
      const data = await res.json();
      const updates: any[] = data?.result ?? [];
      for (const update of updates) {
        offset = update.update_id + 1;
        processUpdate(update, token, db, apiKey).catch(e =>
          console.error('[Bot] Ошибка обработки обновления:', e)
        );
      }
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError';
      if (!isAbort) {
        console.error('[Bot] Ошибка polling:', e?.message || e);
        await new Promise(r => setTimeout(r, POLLING_ERROR_RETRY_DELAY_MS));
      }
    }
    setImmediate(poll);
  };

  console.log('[Bot] Long-polling запущен, ожидаю сообщений...');
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

  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) {
    console.warn('[Bot] ROUTERAI_API_KEY не установлен — бот отключён');
    return;
  }

  app.post('/api/telegram', (req, res) => {
    res.status(200).end();
    processUpdate(req.body, token, db, apiKey).catch(e =>
      console.error('[Bot] Ошибка вебхука:', e)
    );
  });

  console.log('[Bot] Маршруты зарегистрированы: POST /api/telegram');
}

export async function startBot(db: Pool): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return;

  const tokenOk = await validateToken(token);
  if (!tokenOk) {
    console.error('[Bot] Бот не запущен из-за ошибки токена.');
    return;
  }

  const appUrl = process.env.APP_URL || null;

  if (appUrl) {
    await setupWebhook(token, appUrl);
  } else {
    console.log('[Bot] APP_URL не задан — запускаем long-polling');
    startLongPolling(token, db, apiKey);
  }
}

// ─── Notification & Proactive schedulers ────────────────────────────────────

async function sendProactiveMessages(token: string, db: Pool): Promise<void> {
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return;

  try {
    const today = new Date().toISOString().split('T')[0];

    const { rows: users } = await db.query(
      `SELECT p.user_id, p.telegram_chat_id
       FROM user_profiles p
       WHERE p.telegram_chat_id IS NOT NULL
         AND (p.last_active_at IS NULL OR p.last_active_at::date < $1::date)`,
      [today]
    );

    for (const user of users) {
      try {
        const [tasksRes, threadsRes] = await Promise.all([
          db.query(
            `SELECT name, date, time FROM user_tasks
             WHERE user_id = $1 AND done = false
             ORDER BY date ASC, time ASC NULLS LAST LIMIT 5`,
            [user.user_id]
          ),
          db.query(
            `SELECT title, summary FROM user_threads
             WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful = true
             ORDER BY updated_at DESC LIMIT 3`,
            [user.user_id]
          ),
        ]);

        if (tasksRes.rows.length === 0 && threadsRes.rows.length === 0) continue;

        const taskLines = tasksRes.rows.map((t: any) => {
          const when = t.date === today ? 'сегодня' : t.date;
          return `- ${t.name} (${when}${t.time ? ', ' + t.time : ''})`;
        }).join('\n');

        const threadLines = threadsRes.rows.map((t: any) =>
          `[${t.title}]: ${t.summary?.slice(0, 120)}`
        ).join('\n');

        const userContext = [
          taskLines ? `Незакрытые задачи:\n${taskLines}` : '',
          threadLines ? `Из прошлых разговоров:\n${threadLines}` : '',
        ].filter(Boolean).join('\n\n');

        const prompt = `Ты — Мысль, персональный AI-ассистент. Сгенерируй одно короткое проактивное сообщение пользователю.\n\nКонтекст пользователя:\n${userContext}\n\nПравила:\n- Максимум 2 предложения\n- Конкретная отсылка к реальному контексту\n- Никогда: "Как дела?", "Чем могу помочь?"\n- Plaintext, без кавычек`;

        const response = await fetch('https://routerai.ru/api/v1/chat/completions', tgFetchOptions({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.8, thinking: false }),
        }));

        if (!response.ok) continue;
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text || text.length < 10) continue;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, tgFetchOptions({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: user.telegram_chat_id, text }),
        }));

        console.log(`[Proactive] Отправлено пользователю ${user.user_id}`);
      } catch (e: any) {
        console.error(`[Proactive] Ошибка для ${user.user_id}:`, e?.message);
      }
    }
  } catch (e: any) {
    console.error('[Proactive] Ошибка:', e?.message);
  }
}

export function startProactiveScheduler(token: string, db: Pool): void {
  const HOUR = 9;
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      sendProactiveMessages(token, db).catch(e => console.error('[Proactive]', e));
      setInterval(() => sendProactiveMessages(token, db).catch(e => console.error('[Proactive]', e)), 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Proactive] Следующая отправка в ${next.toISOString()}`);
  };
  scheduleNext();
}

export async function startNotificationScheduler(token: string, db: Pool): Promise<void> {
  const REMIND_BEFORE_MIN = 15;

  const tick = async () => {
    try {
      const now = new Date();
      const targetTime = new Date(now.getTime() + REMIND_BEFORE_MIN * 60 * 1000);
      const todayStr = now.toISOString().split('T')[0];
      const hh = String(targetTime.getHours()).padStart(2, '0');
      const mm = String(targetTime.getMinutes()).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;

      const { rows } = await db.query(
        `SELECT t.id, t.name, t.user_id, p.telegram_chat_id
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.date = $1 AND t.time = $2 AND t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND (t.notified_at IS NULL OR t.notified_at < NOW() - INTERVAL '23 hours')`,
        [todayStr, timeStr]
      );

      for (const row of rows) {
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, tgFetchOptions({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: row.telegram_chat_id, text: `⏰ Через ${REMIND_BEFORE_MIN} минут: ${row.name}` }),
          }));
          await db.query(`UPDATE user_tasks SET notified_at = NOW() WHERE id = $1`, [row.id]);
        } catch (e: any) {
          console.error('[Notif] Ошибка отправки:', e?.message);
        }
      }
    } catch (e: any) {
      console.error('[Notif] Ошибка планировщика:', e?.message);
    }
  };

  setInterval(tick, 60_000);
  console.log('[Notif] Планировщик уведомлений запущен (интервал 1 мин)');
}
