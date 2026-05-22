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
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const proxyUrlGlobal = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrlGlobal) {
  setGlobalDispatcher(new ProxyAgent(proxyUrlGlobal));
  console.log('[Bot] Прокси установлен:', proxyUrlGlobal.replace(/:([^@]+)@/, ':***@'));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TgUser { id: number; first_name: string; username?: string; }
interface TgVoice { file_id: string; duration: number; }
interface TgMessage {
  message_id: number;
  from: TgUser;
  chat: { id: number };
  text?: string;
  voice?: TgVoice;
  forward_date?: number;
  forward_from?: TgUser;
  forward_from_chat?: { title?: string };
  caption?: string;
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
const CONTEXT_WINDOW = 12;
const MAX_TOOL_ITERATIONS = 5;
const MAX_BUTTON_TEXT_LENGTH = 32;
const POLLING_ERROR_RETRY_DELAY_MS = 5_000;

// ─── System prompt ────────────────────────────────────────────────────────────

function getSystemInstruction(tz = 'Europe/Moscow'): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });

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
— set_reminder: когда пользователь просит напомнить о чём-либо через X минут/часов, или в конкретное время

НАПОМИНАНИЯ
Если пользователь пишет "напомни через 20 минут", "напомни в 15:30", "поставь напоминание" — используй set_reminder.
Если пользователь создаёт задачу со временем и НЕ упомянул напоминание — спроси один раз: "Напомнить за 15 минут?" (только если задача сегодня или завтра).

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
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Установить напоминание. Используй когда пользователь просит напомнить через X минут/часов или в конкретное время, а также когда соглашается на предложение напомнить.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'ID задачи, к которой привязать напоминание (если есть).' },
          remind_at_iso: { type: 'string', description: 'Дата и время напоминания в ISO 8601 (например 2025-05-22T15:30:00). Вычисли из "через X минут" используя текущее время из системного промпта.' },
          label: { type: 'string', description: 'Текст напоминания — что именно напомнить.' }
        },
        required: ['remind_at_iso', 'label']
      }
    }
  }
];

// ─── Conflict & dependency check ─────────────────────────────────────────────

async function checkTaskConflicts(
  db: Pool,
  userId: string,
  task: { id: string; name: string; time?: string; date?: string }
): Promise<string[]> {
  const warnings: string[] = [];

  // 1. Конфликт по времени (±30 минут, тот же день)
  if (task.time && task.date) {
    const [h, m] = task.time.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      const taskMinutes = h * 60 + m;
      const { rows: conflicts } = await db.query(
        `SELECT name, time FROM user_tasks
         WHERE user_id = $1 AND date = $2 AND id != $3 AND done = false
           AND time IS NOT NULL AND time != ''`,
        [userId, task.date, task.id]
      );
      for (const c of conflicts) {
        const [ch, cm] = c.time.split(':').map(Number);
        if (isNaN(ch) || isNaN(cm)) continue;
        const diff = Math.abs(taskMinutes - (ch * 60 + cm));
        if (diff <= 30) {
          warnings.push(`конфликт по времени: "${c.name}" в ${c.time} — пересечение ±30 минут`);
        }
      }
    }
  }

  // 2. Дедлайн-цепочка — если у задачи есть время, ищем задачи на тот же день без времени
  // которые семантически могут быть подготовительными (содержат похожие слова)
  if (task.date && task.name) {
    const keywords = task.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length > 0) {
      const { rows: related } = await db.query(
        `SELECT name, time, date FROM user_tasks
         WHERE user_id = $1 AND id != $2 AND done = false AND date >= $3
           AND date <= ($3::date + interval '3 days')::text`,
        [userId, task.id, task.date]
      );
      for (const r of related) {
        if (r.id === task.id) continue;
        const rWords = r.name.toLowerCase().split(/\s+/);
        const overlap = keywords.filter(k => rWords.some((w: string) => w.includes(k) || k.includes(w)));
        if (overlap.length >= 2) {
          const when = r.date === task.date ? 'сегодня' : `${r.date}`;
          const timeStr = r.time ? ` в ${r.time}` : '';
          warnings.push(`связанная задача: "${r.name}"${timeStr} (${when}) — возможно нужно выполнить в связке`);
        }
      }
    }
  }

  return warnings;
}

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, args: any, db: Pool, userId: string): Promise<any> {
  const userTz = await getUserTimezone(db, userId);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: userTz });

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
      const taskDate = String(args.date || today);
      const taskTime = String(args.time || '');
      const taskName = String(args.name);
      await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, 'regular', '[]'::jsonb, NOW(), NOW())`,
        [id, userId, taskName, taskTime, taskDate]
      );
      const warnings = await checkTaskConflicts(db, userId, { id, name: taskName, time: taskTime, date: taskDate });
      return { success: true, id, ...(warnings.length > 0 ? { warnings } : {}) };
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
      const { rows: updated } = await db.query(
        `SELECT name, time, date FROM user_tasks WHERE id = $1 AND user_id = $2`,
        [String(args.id), userId]
      );
      if (updated[0] && (args.time || args.date)) {
        const warnings = await checkTaskConflicts(db, userId, { id: String(args.id), ...updated[0] });
        return { success: true, ...(warnings.length > 0 ? { warnings } : {}) };
      }
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
    case 'set_reminder': {
      const remindAt = new Date(String(args.remind_at_iso));
      if (isNaN(remindAt.getTime())) return { error: 'Некорректное время напоминания' };

      // Добавляем колонку если ещё нет (идемпотентно)
      await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ`).catch(() => {});
      await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_notified_at TIMESTAMPTZ`).catch(() => {});

      if (args.task_id) {
        // Привязываем к существующей задаче
        await db.query(
          `UPDATE user_tasks SET remind_at = $1, remind_notified_at = NULL WHERE id = $2 AND user_id = $3`,
          [remindAt.toISOString(), String(args.task_id), userId]
        );
        return { success: true, remind_at: remindAt.toISOString() };
      } else {
        // Создаём задачу-напоминание
        const id = crypto.randomUUID();
        const label = String(args.label);
        const taskDate = remindAt.toLocaleDateString('sv-SE', { timeZone: userTz });
        const taskTime = remindAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
        await db.query(
          `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, created_at, updated_at, remind_at)
           VALUES ($1, $2, $3, $4, $5, false, 'regular', '[]'::jsonb, NOW(), NOW(), $6)`,
          [id, userId, label, taskTime, taskDate, remindAt.toISOString()]
        );
        return { success: true, id, remind_at: remindAt.toISOString() };
      }
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
  const timeoutId = setTimeout(() => controller.abort(), 55000);
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

async function getUserTimezone(db: Pool, userId: string): Promise<string> {
  try {
    const { rows } = await db.query(`SELECT timezone FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    return rows[0]?.timezone || 'Europe/Moscow';
  } catch { return 'Europe/Moscow'; }
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
  const userTz = await getUserTimezone(db, userId);

  const loopMessages = [
    ...buildSafeHistory(threadMessages),
    { role: 'user' as const, content: userText }
  ];
  const newMessages: StoredMessage[] = [userMsg];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const data = await callRouterAI(apiKey, {
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'system', content: getSystemInstruction(userTz) }, ...loopMessages],
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
        text: `✅ Готово, ${escapeHtml(firstName)}! Telegram подключён к Мысли.\n\nТеперь я буду напоминать тебе о задачах прямо сюда, за 15 минут до начала.\n\n/tasks — задачи на сегодня\n/help — список команд`
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
    text: `Привет, ${escapeHtml(firstName)}! Я Мысль — твой персональный помощник по планированию.\n\nЧтобы получать уведомления о задачах, подключи меня в настройках приложения.\n\nЕсли уже подключил — просто пиши:\n"Встреча с командой завтра в 10"\n"Что у меня на сегодня?"\n\n/tasks — задачи на сегодня\n/help — список команд`
  });
}

async function handleHelp(token: string, chatId: number): Promise<void> {
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Доступные команды:\n\n/tasks — показать задачи на сегодня\n/help — эта справка\n\nЛибо просто напиши мне что угодно — добавить задачу, узнать план на завтра, переспросить что-то важное.`
  });
}

async function handleTasks(token: string, chatId: number, db: Pool, userId: string): Promise<void> {
  const userTz = await getUserTimezone(db, userId);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: userTz });
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
  if (!message?.from) return;
  // Принимаем: текст, голос, пересланные сообщения (с текстом или caption)
  if (!message.text && !message.voice && !message.caption) return;

  const chatId = message.chat.id;

  // /start обрабатываем до проверки привязки
  if (message.text?.startsWith('/start')) {
    const tgUserId = message.from.id;
    const tgUserfallbackId = `tg_${tgUserId}`;
    const parts = message.text.split(' ');
    const linkCode = parts[1]?.trim() || undefined;
    await handleStart(token, chatId, message.from.first_name, db, tgUserfallbackId, linkCode);
    return;
  }

  // Проверяем привязку — без неё общение закрыто
  const webUserId = await getWebUserId(db, chatId);
  if (!webUserId) {
    await tgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: `Чтобы общаться со мной, сначала подключи Telegram в приложении.\n\nОткрой приложение → Настройки → Telegram → Подключить. Получишь код — введи его командой /start КОД`
    });
    return;
  }

  if (message.text === '/help') { await handleHelp(token, chatId); return; }
  if (message.text === '/tasks') { await handleTasks(token, chatId, db, webUserId); return; }

  // ── Голосовое сообщение → транскрипция через Whisper ─────────────────────
  let userText = message.text?.trim() || message.caption?.trim() || '';

  if (message.voice) {
    let tmpIn = '';
    let tmpOut = '';
    try {
      const vsegptKey = process.env.VSEGPT_API_KEY;
      if (!vsegptKey) throw new Error('VSEGPT_API_KEY не задан');

      // Скачиваем ogg от Telegram
      const fileRes = await tgApi(token, 'getFile', { file_id: message.voice.file_id });
      const filePath = fileRes?.result?.file_path;
      if (!filePath) throw new Error('file_path не получен');

      const audioUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const audioRes = await fetch(audioUrl, tgFetchOptions());
      if (!audioRes.ok) throw new Error(`Ошибка скачивания аудио: ${audioRes.status}`);
      const audioBuffer = await audioRes.arrayBuffer();

      // Сохраняем ogg во временный файл
      tmpIn  = path.join(os.tmpdir(), `tg_voice_${Date.now()}.ogg`);
      tmpOut = path.join(os.tmpdir(), `tg_voice_${Date.now()}.wav`);
      fs.writeFileSync(tmpIn, Buffer.from(audioBuffer));

      // Конвертируем ogg → wav через ffmpeg
      await execFileAsync('ffmpeg', ['-y', '-i', tmpIn, '-vn', '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', '-f', 'wav', tmpOut]);
      const wavBuffer = fs.readFileSync(tmpOut);

      // Транскрибируем через VseGPT (тот же эндпоинт что и в вебе)
      const formData = new FormData();
      formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
      formData.append('model', 'stt-openai/whisper-v3-turbo');
      formData.append('language', 'ru');

      const whisperRes = await fetch('https://api.vsegpt.ru/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${vsegptKey}` },
        body: formData,
      });
      if (!whisperRes.ok) throw new Error(`VseGPT error: ${whisperRes.status}`);
      const whisperData: any = await whisperRes.json();
      userText = whisperData.text?.trim() || '';
      console.log(`[Bot] Транскрипция: "${userText}"`);
    } catch (e: any) {
      console.error('[Bot] Ошибка транскрипции:', e?.message);
      await tgApi(token, 'sendMessage', { chat_id: chatId, text: 'Не смог распознать голосовое, попробуй ещё раз' });
      return;
    } finally {
      if (tmpIn  && fs.existsSync(tmpIn))  fs.unlinkSync(tmpIn);
      if (tmpOut && fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  }

  if (!userText) return;

  // ── Пересланное сообщение — подсказываем ИИ контекст ────────────────────
  const isForwarded = Boolean(message.forward_date);
  if (isForwarded) {
    const source = message.forward_from_chat?.title || message.forward_from?.first_name || '';
    userText = `[Пересланное сообщение${source ? ` от "${source}"` : ''}]\n${userText}\n\n[Вытащи из этого события дату, время и название. Добавь как задачу если там есть конкретное мероприятие или дедлайн]`;
  }

  // Обновляем last_active_at
  db.query(`UPDATE user_profiles SET last_active_at = NOW() WHERE user_id = $1`, [webUserId]).catch(() => {});

  // Все остальные сообщения → AI (Мысль)
  const thread = await loadBotThread(db, webUserId);
  const existingMessages = thread?.messages ?? [];

  console.log(`[Bot] вызываю AI для ${webUserId}, сообщение: "${userText.slice(0, 80)}"`);
  try {
    const { aiResponse, newMessages } = await processWithAI(
      userText,
      existingMessages,
      db,
      webUserId,
      apiKey
    );
    console.log(`[Bot] AI ответил: "${aiResponse?.slice(0, 80)}"`);
    await saveBotThread(db, webUserId, thread?.id ?? null, [...existingMessages, ...newMessages]);
    const cleanResponse = aiResponse.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,3}\s/gm, '');
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: cleanResponse });
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
    const { rows: users } = await db.query(
      `SELECT p.user_id, p.telegram_chat_id, COALESCE(p.timezone, 'Europe/Moscow') AS timezone
       FROM user_profiles p
       WHERE p.telegram_chat_id IS NOT NULL`
    );

    const now = new Date();
    const activeUsers = users.filter((u: any) => {
      const todayInTz = now.toLocaleDateString('sv-SE', { timeZone: u.timezone });
      return !u.last_active_at || new Date(u.last_active_at).toLocaleDateString('sv-SE', { timeZone: u.timezone }) < todayInTz;
    });

    for (const user of activeUsers) {
      try {
        const userTodayInTz = now.toLocaleDateString('sv-SE', { timeZone: user.timezone });
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
          const when = t.date === userTodayInTz ? 'сегодня' : t.date;
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

// Возвращает смещение таймзоны в миллисекундах для данного момента
// Пример: для Europe/Moscow (UTC+3) вернёт -3*60*60*1000 = -10800000
function getTimezoneOffsetMs(date: Date, tz: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
  return new Date(utcStr).getTime() - new Date(tzStr).getTime();
}

export async function startNotificationScheduler(token: string, db: Pool): Promise<void> {
  const REMIND_BEFORE_MIN = 15;

  // Добавляем колонки при старте (идемпотентно)
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ`).catch(() => {});
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_notified_at TIMESTAMPTZ`).catch(() => {});

  const sendNotification = async (chatId: string, text: string, taskId: string, column: 'notified_at' | 'remind_notified_at') => {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, tgFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }));
    await db.query(`UPDATE user_tasks SET ${column} = NOW() WHERE id = $1`, [taskId]);
  };

  const tick = async () => {
    try {
      const now = new Date();
      const targetTime = new Date(now.getTime() + REMIND_BEFORE_MIN * 60 * 1000);

      // ── 1. Напоминания за 15 минут до задачи с временем ──────────────────────
      // Строим временной диапазон: задача должна начаться между +14 и +16 минутами от сейчас
      // Это даёт окно в 2 минуты, но notified_at защищает от повторов
      const windowStart = new Date(now.getTime() + (REMIND_BEFORE_MIN - 1) * 60 * 1000);
      const windowEnd   = new Date(now.getTime() + (REMIND_BEFORE_MIN + 1) * 60 * 1000);

      const { rows } = await db.query(
        `SELECT t.id, t.name, t.date, t.time, t.user_id, p.telegram_chat_id,
                COALESCE(p.timezone, 'Europe/Moscow') AS timezone
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND (t.notified_at IS NULL OR t.notified_at < NOW() - INTERVAL '23 hours')
           AND t.time IS NOT NULL AND t.time != ''`,
        []
      );

      const toNotify = rows.filter((row: any) => {
        const tz = row.timezone || 'Europe/Moscow';
        const dateStr = row.date; // YYYY-MM-DD
        const timeStr = row.time; // HH:MM
        if (!dateStr || !timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return false;
        // Получаем UTC-момент задачи:
        // 1. Парсим как UTC (суффикс Z)
        // 2. Узнаём смещение таймзоны пользователя в этот момент
        // 3. Корректируем
        const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
        const tzOffset = getTimezoneOffsetMs(naiveUtc, tz);
        const taskUtc = new Date(naiveUtc.getTime() - tzOffset);
        return taskUtc >= windowStart && taskUtc <= windowEnd;
      });

      for (const row of toNotify) {
        try {
          await sendNotification(row.telegram_chat_id, `⏰ Через ${REMIND_BEFORE_MIN} минут: ${row.name}`, row.id, 'notified_at');
        } catch (e: any) {
          console.error('[Notif] Ошибка отправки (time):', e?.message);
        }
      }

      // ── 2. Плавающие напоминания через remind_at ─────────────────────────────
      const { rows: remindRows } = await db.query(
        `SELECT t.id, t.name, t.remind_at, t.user_id, p.telegram_chat_id
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND t.remind_at IS NOT NULL
           AND t.remind_at <= NOW()
           AND (t.remind_notified_at IS NULL OR t.remind_notified_at < t.remind_at)`,
        []
      );

      for (const row of remindRows) {
        try {
          await sendNotification(row.telegram_chat_id, `🔔 Напоминание: ${row.name}`, row.id, 'remind_notified_at');
        } catch (e: any) {
          console.error('[Notif] Ошибка отправки (remind_at):', e?.message);
        }
      }

    } catch (e: any) {
      console.error('[Notif] Ошибка планировщика:', e?.message);
    }
  };

  setInterval(tick, 60_000);
  tick(); // первый тик сразу при старте
  console.log('[Notif] Планировщик уведомлений запущен (интервал 1 мин)');
}
