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
import { ProxyAgent, setGlobalDispatcher, Agent, fetch as undiciFetch } from 'undici';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as polisad from './src/polisad/index.ts';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// Тёплый пул соединений: бот получает сообщения редко, дефолтный keepAliveTimeout
// (4с) роняет коннект между запросами → каждый раз новый TLS-хендшейк (1-2с в TTFT).
// Держим соединения живыми минуту, чтобы хендшейк не повторялся.
const KEEPALIVE_OPTS = { keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000, connections: 8 };

const proxyUrlGlobal = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrlGlobal) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrlGlobal, ...KEEPALIVE_OPTS }));
  console.log('[Bot] Прокси установлен:', proxyUrlGlobal.replace(/:([^@]+)@/, ':***@'));
}

// Прямой диспетчер — в обход глобального прокси. routerai.ru — российский, и если
// VPS в РФ, до него можно ходить НАПРЯМУЮ (ROUTERAI_DIRECT=1), убирая лишний хоп.
const directDispatcher = new Agent(KEEPALIVE_OPTS);

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
  // Для проактивных напоминаний: id задачи, о которой напоминали. В UI не
  // показывается — подмешивается в контекст модели в toGroqFormat, чтобы
  // «перенеси» после напоминания не требовал угадывания через get_tasks.
  task_id?: string;
}

function tgFetchOptions(extra: RequestInit = {}): RequestInit {
  return extra;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_THREAD_TITLE = polisad.BOT_THREAD_TITLE;
const CONTEXT_WINDOW = polisad.CONTEXT_WINDOW;
const MAX_TOOL_ITERATIONS = 5;
const MAX_BUTTON_TEXT_LENGTH = 32;
const POLLING_ERROR_RETRY_DELAY_MS = 5_000;

// Rich Messages (Bot API 10.1+): бот шлёт Markdown, Telegram сам рендерит списки/
// код/таблицы на клиенте. За флагом — при любой проблеме выключается без деплоя.
const RICH_MESSAGES_ENABLED = process.env.RICH_MESSAGES_ENABLED !== '0';
const RICH_MAX_LEN = 32_768;  // лимит длины rich-сообщения (против 4096 у обычного)

// ─── System prompt ────────────────────────────────────────────────────────────

function getSystemInstruction(tz = 'Europe/Moscow'): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  // Готовые даты, чтобы модель НЕ считала их сама — источник путаницы «завтра/послезавтра».
  const todayISO = now.toLocaleDateString('sv-SE', { timeZone: tz });
  const addDays = (iso: string, n: number) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const tomorrowISO = addDays(todayISO, 1);
  const afterISO = addDays(todayISO, 2);

  return `Ты — Мысль, личный ассистент по организации дел и мышлению.

Отвечай только на русском. Не используй эмодзи.

Форматирование — экономно, по умолчанию живой чистый текст. Можно лёгкий Markdown, но по делу:
— списком (- или 1.) — когда разбиваешь цель на шаги или перечисляешь задачи
— код-блоком — когда просят код
— таблицей — только если это правда самый удобный способ показать данные
Короткий ответ, диалог, подтверждение — просто текст, без разметки. Не форматируй ради форматирования.

ХАРАКТЕР
Говори как умный человек, а не как сервис. Коротко, прямо, без воды. Человечно — но без слащавости и дежурных фраз. Если можно ответить одним словом — ответь одним словом.

Точки в конце: ставь точку только когда она реально нужна — в конце длинного абзаца или сложного предложения. Короткие ответы, реплики, перечисления, вопросы — без точки в конце. Чувствуй ритм текста

Никогда не начинай ответ с "Конечно!", "Отлично!", "Понял!", "Вот:", "Хорошо!" и любых других вводных. Сразу к делу

ГЛАВНЫЕ ПРАВИЛА
— Меньше слов = лучше. Каждое слово должно нести смысл
— Если чего-то не знаешь или не можешь — говори прямо. Не придумывай
— Задавай уточняющие вопросы когда контекст неполный. Один вопрос за раз, не анкету
— Учитывай всё что пользователь говорил раньше в диалоге. Но свежее важнее старого: короткая реплика относится к последнему событию в диалоге, а не к разговору часовой давности
— Если пришёл сырой brain dump — сначала структурируй, потом уточняй детали
— Никогда не говори "у меня нет доступа к этой информации" про свои собственные возможности

ПАМЯТЬ — КРИТИЧНО
Ты имеешь доступ к прошлым разговорам и заметкам пользователя. Они уже загружены в этот промпт в разделах "Из архива пользователя", "Что пользователь рассказал о себе", "Вчера в боте". Это и есть твоя память.
НИКОГДА не говори: "у меня нет доступа к веб-чатам", "нет инструментов для этого", "не вижу историю других сессий". Это неправда.
Правильный ответ когда спрашивают про память: "Да, у меня есть контекст из твоих прошлых разговоров" — и процитируй что именно видишь в архиве. Если конкретного разговора нет в контексте — скажи "этого конкретного разговора сейчас нет в загруженном контексте".

РАБОТА С ЗАДАЧАМИ — КРИТИЧНО
— Создавай ТОЛЬКО те задачи, которые пользователь явно назвал в текущем сообщении. Никогда не выдумывай задачи из архива, прошлых дней или «ближайших задач» — это справка/контекст, а НЕ список дел, который надо завести.
— Перед добавлением или переносом задачи сперва вызови get_tasks на нужную дату и посмотри, что там уже стоит. Если похожая задача уже есть — не добавляй дубль.
— Перенос/сдвиг задачи — это ТОЛЬКО update_task по id существующей задачи. Никогда не создавай новую похожую и не удаляй старую ради переноса — это плодит дубли.
— Одна просьба = одно действие. Не вызывай один и тот же инструмент с теми же данными повторно.

ВОПРОСЫ О ПРОШЛЫХ ДНЯХ («что я не сделал», «что было вчера»)
— Всегда вызывай get_tasks с КОНКРЕТНОЙ датой того дня, о котором спрашивают (вчера = дата из блока дат ниже минус день). Без даты get_tasks отдаёт ВСЕ дни вперемешку — по такому списку отвечать нельзя.
— Никогда не смешивай дни: невыполненное позавчера — не «вчерашнее». Если в ответе несколько дней — явно называй даты.
— Не гадай о судьбе задач («видимо, перенеслась»). Видишь в данных — говори. Не видишь — скажи что не знаешь.

ПЕРЕСТРОЙКА РАСПИСАНИЯ
Когда пользователь сдвигает задачу:
1. Сначала get_tasks на эту дату
2. Сдвинь нужную задачу через update_task (по id)
3. Если конфликтов с другими нет — молча выполни, не трогай остальные
4. Если конфликты есть — предложи решение и жди подтверждения, прежде чем двигать другие задачи

НАПОМИНАНИЯ
Если пользователь создаёт задачу со временем на сегодня/завтра и НЕ упомянул напоминание — спроси один раз: "Напомнить за 15 минут?"

ВРЕМЯ И ДАТА — КРИТИЧНО
Все time и date в инструментах — ЛОКАЛЬНОЕ время МСК. Никакого UTC, никакого смещения. "в 23:00" → time="23:00". НЕ переводи в UTC, не прибавляй и не вычитай часы.
Даты НЕ вычисляй сам — бери готовые:
  Сегодня: ${dateStr} = ${todayISO}
  Завтра = ${tomorrowISO}
  Послезавтра = ${afterISO}
«сегодня» → date=${todayISO}; «завтра» → date=${tomorrowISO}; «послезавтра» → date=${afterISO}. Для других дней («в пятницу», «15-го») считай от сегодняшней даты выше и перепроверь день недели.

«Перенеси на N» с голым числом N ≤ 24 — это почти всегда ЧАС (time="N:00"), особенно если у задачи уже есть время сегодня. Дата — только если пользователь явно сказал «на 16-е», «на 16 июля» или назвал день недели. Сомневаешься — спроси «16:00 сегодня?», но никогда молча не двигай задачу на другой день, если пользователь просил другое время.

Текущее время: ${timeStr} (Москва)

АВТОМАТИЧЕСКИЕ НАПОМИНАНИЯ В ИСТОРИИ
В истории диалога могут встречаться сообщения, начинающиеся с ⏰ или 🔔 — это твои собственные напоминания, отправленные системой напоминаний от твоего имени, а не пользователем.
— Если пользователь отвечает на такое напоминание или ссылается на него — продолжай разговор естественно, как будто напомнила именно ты
— КЛЮЧЕВОЕ: короткая команда сразу после напоминания («перенеси на 16», «сделал», «отмени», «завтра в это же время») относится к задаче ИЗ ЭТОГО НАПОМИНАНИЯ, а не к более ранним темам разговора. Напоминание — самое свежее событие, оно перевешивает старые списки и предложения
— У напоминания в истории есть привязка [задача: id] — используй этот id напрямую, get_tasks не нужен. Перенос после 🔔 → set_reminder с этим task_id и новым временем. Перенос после ⏰ (задача со временем старта) → update_task этой задачи. НИКОГДА не создавай новую задачу или задачу-напоминание, когда речь о существующей
— В ответе называй задачу по имени («Перенесла напоминание про пост на завтра, 17:20»), а не «готово» без контекста
— Не извиняйся за эмодзи в этих сообщениях и не переспрашивай, что это такое
— Не повторяй и не пересказывай само напоминание — сразу переходи к сути ответа`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const botTools: any[] = [
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'Получить список задач пользователя. Используй когда спрашивает о планах, задачах, расписании или нужен ID задачи перед update. ВСЕГДА передавай date, если речь об одном дне — без date вернутся все дни вперемешку.',
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
      description: 'Добавить новую задачу. Жёсткое время → time/endTime. Гибкая → suggestedTime/suggestedEndTime (без time). НИКОГДА не создавай задачи "Напомнить о [X]" — для напоминаний есть set_reminder.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название задачи.' },
          time: { type: 'string', description: 'ФИКСИРОВАННОЕ ЛОКАЛЬНОЕ время начала HH:MM (МСК) — только если время названо жёстко. НЕ переводить в UTC.' },
          endTime: { type: 'string', description: 'ЛОКАЛЬНОЕ время окончания HH:MM (МСК), если ясна длительность. НЕ переводить в UTC.' },
          suggestedTime: { type: 'string', description: 'РЕКОМЕНДУЕМОЕ ЛОКАЛЬНОЕ время HH:MM (МСК) для гибкой задачи без жёсткого времени — предложи удобный слот. Задача останется гибкой. НЕ переводить в UTC.' },
          suggestedEndTime: { type: 'string', description: 'Конец рекомендуемого слота HH:MM (МСК).' },
          date: { type: 'string', description: 'ЛОКАЛЬНАЯ дата пользователя YYYY-MM-DD (МСК). По умолчанию — сегодня по МСК.' },
          category: { type: 'string', enum: ['work', 'personal', 'event', 'study'], description: 'Сфера задачи: work (работа), personal (личное), event (встреча/мероприятие), study (учёба). Определи по смыслу. Если непонятно — не указывай.' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Обновить задачу (время, дату, статус, имя). При сдвиге расписания — update существующей, НЕ удалять и создавать заново. Если не знаешь ID — сначала get_tasks. Не менять название без явной просьбы.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID задачи.' },
          done: { type: 'boolean', description: 'Статус выполнения.' },
          name: { type: 'string', description: 'Новое название.' },
          time: { type: 'string', description: 'Новое ЛОКАЛЬНОЕ время начала HH:MM (МСК). НЕ переводить в UTC.' },
          endTime: { type: 'string', description: 'Новое ЛОКАЛЬНОЕ время окончания HH:MM (МСК). НЕ переводить в UTC.' },
          date: { type: 'string', description: 'Новая ЛОКАЛЬНАЯ дата YYYY-MM-DD (МСК).' },
          category: { type: 'string', enum: ['work', 'personal', 'event', 'study'], description: 'Сфера задачи: work, personal, event, study.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Удалить задачу. При сдвиге расписания — использовать update_task, не delete.',
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
      description: 'Установить напоминание. Когда пользователь пишет "напомни через X минут/часов", "напомни в 15:30", или соглашается на предложение напомнить.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'ID задачи, к которой привязать напоминание (если есть).' },
          remind_at_iso: { type: 'string', description: 'Дата и время напоминания в формате YYYY-MM-DDTHH:MM — ЛОКАЛЬНОЕ время пользователя (МСК). Например: "2026-06-01T18:30". НЕ переводить в UTC, НЕ добавлять Z или +00:00. Для "через X минут" прибавляй к текущему времени МСК из системного промпта.' },
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
      const taskEnd = args.endTime ? String(args.endTime) : null;
      const taskSuggested = args.suggestedTime ? String(args.suggestedTime) : null;
      const taskSuggestedEnd = args.suggestedEndTime ? String(args.suggestedEndTime) : null;
      const taskCategory = args.category ? String(args.category) : null;
      const taskName = String(args.name);
      // Время предложено агентом → time_source 'agent'. Без времени — null.
      const taskSource = taskTime ? 'agent' : null;
      await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, end_time, category, time_source, suggested_time, suggested_end_time, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, false, 'regular', '[]'::jsonb, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [id, userId, taskName, taskTime, taskDate, taskEnd, taskCategory, taskSource, taskSuggested, taskSuggestedEnd]
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
      if (args.time !== undefined) {
        updates.push(`time = $${idx++}`); params.push(String(args.time || ''));
        // Агент сдвинул время → источник 'agent'.
        updates.push(`time_source = $${idx++}`); params.push('agent');
      }
      if (args.endTime !== undefined) { updates.push(`end_time = $${idx++}`); params.push(args.endTime ? String(args.endTime) : null); }
      if (args.category !== undefined) { updates.push(`category = $${idx++}`); params.push(args.category ? String(args.category) : null); }
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
      // AI передаёт локальное время МСК без суффикса Z. new Date() без Z парсит как UTC — неверно.
      // Явно конвертируем локальное время в UTC через localTimeToUtc.
      const isoStr = String(args.remind_at_iso).replace('Z', '').slice(0, 16); // YYYY-MM-DDTHH:MM
      const [datePart, timePart] = isoStr.split('T');
      let remindAt: Date;
      if (datePart && timePart && /^\d{2}:\d{2}$/.test(timePart)) {
        remindAt = localTimeToUtc(datePart, timePart, userTz);
      } else {
        remindAt = new Date(isoStr);
      }
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
        // Создаём задачу-напоминание без time — иначе планировщик пошлёт ещё одно
        // уведомление за 15 минут до time, тогда как remind_at уже точный момент отправки.
        const id = crypto.randomUUID();
        const label = String(args.label);
        const taskDate = remindAt.toLocaleDateString('sv-SE', { timeZone: userTz });
        await db.query(
          `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, created_at, updated_at, remind_at)
           VALUES ($1, $2, $3, '', $4, false, 'regular', '[]'::jsonb, NOW(), NOW(), $5)`,
          [id, userId, label, taskDate, remindAt.toISOString()]
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
    // Привязка напоминания к задаче: хранится отдельным полем (UI рендерит только
    // content), а модели подмешивается в текст — id виден только ей
    if (m.task_id) content += `\n[задача: ${m.task_id}]`;
    const msg: any = { role: m.role, content };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    return msg;
  });
}

const foldOverflowMessages = polisad.foldOverflowMessages;

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

const OPENROUTER_FALLBACK_KEY = process.env.OPENROUTER_FALLBACK_KEY || '';

// Провайдер для СТРИМИНГА (диагностика «гигантских кусков»). RouterAI может не
// отдавать настоящий SSE — тогда стрим вырождается в одну правку. STREAM_PROVIDER=openrouter
// переключает стрим на OpenRouter (ключ OPENROUTER_FALLBACK_KEY), у него полноценный SSE.
// Дефолт — routerai. Нестриминговые вызовы и фоллбек не меняются.
const STREAM_PROVIDER = (process.env.STREAM_PROVIDER || 'routerai').toLowerCase();
const OPENROUTER_STREAM_MODEL = process.env.OPENROUTER_STREAM_MODEL || 'deepseek/deepseek-chat';
// OpenRouter в обход прокси (по умолчанию да). STREAM_OR_DIRECT=0 — через прокси.
const STREAM_OR_DIRECT = (process.env.STREAM_OR_DIRECT || '1') !== '0';
// RouterAI напрямую, мимо прокси (домашний сервис). ROUTERAI_DIRECT=1 — включить.
const ROUTERAI_DIRECT = process.env.ROUTERAI_DIRECT === '1';
// Groq — выделенное LPU-железо, суб-секундный TTFT (тест «скорость как у Perplexity»).
// OpenAI-совместимый API, наш SSE-парсер подходит без изменений. STREAM_PROVIDER=groq.
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_STREAM_MODEL = process.env.GROQ_STREAM_MODEL || 'llama-3.3-70b-versatile';
// Groq — зарубежный сервис: по умолчанию мимо Telegram-прокси. GROQ_DIRECT=0 — через прокси.
const GROQ_DIRECT = (process.env.GROQ_DIRECT || '1') !== '0';

async function callOpenRouterFallback(body: object): Promise<any> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_FALLBACK_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenRouter fallback error: ${response.status}`);
  return await response.json();
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
    if ((response.status === 401 || response.status >= 500) && OPENROUTER_FALLBACK_KEY) {
      console.warn(`[BOT] RouterAI returned ${response.status}, falling back to OpenRouter`);
      return callOpenRouterFallback(body);
    }
    if (!response.ok) throw new Error(`RouterAI error: ${response.status}`);
    return await response.json();
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (OPENROUTER_FALLBACK_KEY && (e?.name === 'AbortError' || e?.message?.includes('RouterAI error'))) {
      console.warn(`[BOT] RouterAI failed (${e?.message}), falling back to OpenRouter`);
      return callOpenRouterFallback(body);
    }
    throw e;
  }
}

// Унифицированный результат одного шага LLM: текст ответа + (опц.) вызовы инструментов.
interface LlmStepResult { content: string; tool_calls?: any[] }

// Стриминговый вызов RouterAI (SSE). Накапливает content и tool_calls из дельт,
// дёргает onDelta(полный_текст_на_данный_момент) по мере прихода текста.
// Возвращает финальный content + собранные tool_calls в форме как у обычного message.
// Бросает исключение при сетевой ошибке/не-2xx — вызывающий код делает фоллбек
// на обычный (нестриминговый) callRouterAI.
async function callRouterAIStream(
  apiKey: string,
  body: object,
  onDelta: (fullContent: string) => void
): Promise<LlmStepResult> {
  // Выбор провайдера стрима. Дефолт RouterAI; STREAM_PROVIDER=openrouter|groq переключает.
  const provider =
    STREAM_PROVIDER === 'openrouter' && OPENROUTER_FALLBACK_KEY ? 'openrouter' :
    STREAM_PROVIDER === 'groq' && GROQ_API_KEY ? 'groq' :
    'routerai';
  // Обход прокси (Telegram-прокси глобальный): RouterAI — по ROUTERAI_DIRECT;
  // зарубежные (OpenRouter/Groq) по умолчанию мимо прокси.
  // Если прямой путь не достучится (fetch failed) — runStep откатится на нестрим-вызов.
  const direct = provider === 'routerai' ? ROUTERAI_DIRECT : provider === 'groq' ? GROQ_DIRECT : STREAM_OR_DIRECT;
  const url =
    provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' :
    provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' :
    'https://routerai.ru/api/v1/chat/completions';
  const key = provider === 'openrouter' ? OPENROUTER_FALLBACK_KEY : provider === 'groq' ? GROQ_API_KEY : apiKey;
  // Чужие провайдеры не знают RouterAI-шный id 'deepseek/deepseek-v4-flash' — подменяем модель.
  const model = provider === 'openrouter' ? OPENROUTER_STREAM_MODEL : provider === 'groq' ? GROQ_STREAM_MODEL : null;
  const sendBody = model ? { ...body, model, stream: true } : { ...body, stream: true };
  const tag = (provider === 'routerai' ? 'routerai' : `${provider}:${model}`) + (direct ? '/direct' : '/proxy');
  const bodyJson = JSON.stringify(sendBody);
  const promptChars = bodyJson.length;  // размер промпта — главный фактор префилла/TTFT
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);
  let response: any;
  try {
    const fetchOpts: any = {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: bodyJson,
    };
    // dispatcher переопределяет глобальный прокси на один запрос — но это умеет
    // ТОЛЬКО fetch из undici. Глобальный fetch Node бросает UND_ERR_INVALID_ARG.
    if (direct) fetchOpts.dispatcher = directDispatcher;
    response = await undiciFetch(url, fetchOpts);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
  if (!response.ok || !response.body) {
    clearTimeout(timeoutId);
    throw new Error(`stream error [${tag}]: ${response.status}`);
  }

  // Страховка: если провайдер проигнорировал stream:true и вернул обычный JSON
  // (не SSE) — разбираем как единичный ответ, а не как поток дельт.
  const ctype = response.headers.get('content-type') || '';
  if (!ctype.includes('event-stream')) {
    clearTimeout(timeoutId);
    const data = await response.json().catch(() => null);
    const m = data?.choices?.[0]?.message;
    const content = typeof m?.content === 'string' ? m.content : '';
    if (content) onDelta(content);
    console.log(`[Bot stream] ${tag} SSE=нет (ctype="${ctype}") промпт=${promptChars}симв → один кусок, ${content.length} симв за ${Date.now() - startedAt}мс`);
    return { content, tool_calls: m?.tool_calls };
  }

  const reader = (response.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let netReads = 0;     // сколько сетевых чанков пришло от провайдера
  let deltaCount = 0;   // сколько текстовых дельт (рост content)
  let firstTokenAt = 0; // момент первого токена — для TTFT
  const toolCallsByIndex = new Map<number, any>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) netReads++;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;
        let json: any;
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content) {
          if (firstTokenAt === 0) firstTokenAt = Date.now();
          content += delta.content;
          deltaCount++;
          onDelta(content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsByIndex.get(idx)
              || { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            toolCallsByIndex.set(idx, existing);
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    try { reader.releaseLock?.(); } catch { /* noop */ }
  }

  // Диагностика: TTFT — пауза до первого токена (если велика — узкое место в
  // промпте/провайдере/прокси, стрим её не лечит); netReads — сетевые чанки;
  // deltaCount — текстовые дельты; gen — скорость генерации после первого токена.
  const totalMs = Date.now() - startedAt;
  const ttft = firstTokenAt ? firstTokenAt - startedAt : totalMs;
  const genMs = firstTokenAt ? Date.now() - firstTokenAt : 0;
  const cps = genMs > 0 ? Math.round(content.length / (genMs / 1000)) : 0;
  console.log(`[Bot stream] ${tag} промпт=${promptChars}симв TTFT=${ttft}мс ген=${genMs}мс (${cps} симв/с) чанков=${netReads} дельт=${deltaCount} ${content.length} симв всего ${totalMs}мс`);

  const tool_calls = toolCallsByIndex.size > 0
    ? [...toolCallsByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : undefined;
  return { content, tool_calls };
}

// Тёплый коннект к routerai.ru: бот пишет редко → пул протухает → холодный
// TLS-хендшейк на каждый запрос (1-2с в TTFT). Лёгкий GET раз в 30с держит
// соединение того же origin (chat + embeddings) живым — реальный запрос его
// переиспользует. Путь warmup совпадает с боевым (прямой/прокси по ROUTERAI_DIRECT).
function startConnectionWarmup(): void {
  const ping = () => {
    const opts: any = { method: 'GET', signal: AbortSignal.timeout(8000) };
    if (ROUTERAI_DIRECT) opts.dispatcher = directDispatcher;
    fetch('https://routerai.ru/', opts)
      .then(r => { try { (r.body as any)?.cancel?.(); } catch { /* noop */ } })
      .catch(() => { /* warmup — ошибки не важны */ });
  };
  ping();
  setInterval(ping, 30_000);
  console.log(`[Bot] Прогрев соединения к routerai.ru каждые 30с (${ROUTERAI_DIRECT ? 'напрямую' : 'через прокси'})`);
}

async function getUserTimezone(db: Pool, userId: string): Promise<string> {
  try {
    const { rows } = await db.query(`SELECT timezone FROM user_profiles WHERE user_id = $1 LIMIT 1`, [userId]);
    return rows[0]?.timezone || 'Europe/Moscow';
  } catch { return 'Europe/Moscow'; }
}

async function buildBotSystemPrompt(userText: string, userId: string, userTz: string, db: Pool, apiKey: string): Promise<string> {
  // Тест латентности (LEAN_MODE=1): отключаем ВСЮ память/RAG/эмбеддинг — только
  // базовый промпт. Замеряем TTFT с пустым контекстом против полного: если те же
  // 4-6с — виноват RouterAI (не префилл/прокси-эмбеддинг); если упал — нашли рычаг.
  if (process.env.LEAN_MODE === '1') {
    console.log('[Bot] LEAN_MODE: контекст/RAG/эмбеддинг отключены (тест латентности)');
    return getSystemInstruction(userTz);
  }

  // Четыре источника контекста независимы — тянем их параллельно (раньше шли
  // последовательно, 4 round-trip'а подряд перед каждым ответом). Каждый блок
  // собирается изолированно, ошибка одного не валит остальные. Порядок склейки
  // фиксированный, чтобы промпт был детерминированным.

  // 1. Профиль пользователя — всегда, без keyword-matching (ПОЛИСАД, слой 1)
  const profileBlock = (async () => {
    try {
      const profileSummaries = await polisad.getProfileSummaries(db, userId);
      if (profileSummaries.length > 0) {
        return `\n\nЧТО ПОЛЬЗОВАТЕЛЬ РАССКАЗАЛ О СЕБЕ\n${profileSummaries.join('\n\n')}`;
      }
    } catch (e: any) {
      console.warn('[Bot RAG] profile inject failed:', e?.message);
    }
    return '';
  })();

  // 2. Summary вчерашнего дня в боте (ПОЛИСАД, слой 3)
  const yesterdayBlock = (async () => {
    try {
      const ySummary = await polisad.getYesterdaySummary(db, userId, userTz);
      if (ySummary) return `\n\nВЧЕРА В БОТЕ\n${ySummary}`;
    } catch (e: any) {
      console.warn('[Bot RAG] yesterday summary failed:', e?.message);
    }
    return '';
  })();

  // 3. Ближайшие задачи (следующие 30 минут)
  const upcomingBlock = (async () => {
    try {
      const now = new Date();
      const todayStr = now.toLocaleDateString('sv-SE', { timeZone: userTz });
      const currentTimeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
      const windowEnd = new Date(now.getTime() + 30 * 60 * 1000);
      const windowEndStr = windowEnd.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: userTz });
      const { rows: upcoming } = await db.query(
        `SELECT name, time FROM user_tasks
         WHERE user_id = $1 AND date = $2 AND done = false
           AND time != '' AND time IS NOT NULL
           AND time >= $3 AND time <= $4
         ORDER BY time ASC LIMIT 5`,
        [userId, todayStr, currentTimeStr, windowEndStr]
      );
      if (upcoming.length > 0) {
        const lines = upcoming.map((t: any) => `- ${t.name} в ${t.time}`).join('\n');
        return `\n\nБЛИЖАЙШИЕ ЗАДАЧИ (следующие 30 минут)\n${lines}\n\nЕсли уместно — упомяни одну из них к месту. Один раз, без навязчивости.`;
      }
    } catch (e: any) {
      console.warn('[Bot RAG] upcoming tasks failed:', e?.message);
    }
    return '';
  })();

  // 3.5. ЗАДАЧИ НА СЕГОДНЯ — детерминированная точка правды прямо в промпте.
  // Модель НЕ должна угадывать «сегодня» через get_tasks (без даты он отдаёт ВСЕ
  // дни → вчерашние невыполненные приписывались сегодня). Здесь — строго date=сегодня,
  // как в календаре. Это авторитетный список; задачи других дней сюда не попадают.
  const todayBlock = (async () => {
    try {
      const now = new Date();
      const todayStr = now.toLocaleDateString('sv-SE', { timeZone: userTz });
      const { rows } = await db.query(
        `SELECT name, time, done FROM user_tasks
         WHERE user_id = $1 AND date = $2
         ORDER BY (time = '' OR time IS NULL) ASC, time ASC`,
        [userId, todayStr]
      );
      if (rows.length > 0) {
        const lines = rows.map((t: any) => {
          const when = t.time && t.time !== '' ? `${t.time} ` : 'без времени — ';
          const status = t.done ? '[выполнено] ' : '';
          return `- ${when}${status}${t.name}`;
        }).join('\n');
        return `\n\nЗАДАЧИ НА СЕГОДНЯ (${todayStr})\nЭто полный и точный список задач на сегодня из календаря. На вопрос «что у меня сегодня» отвечай строго по нему. НЕ добавляй сюда задачи других дней и НЕ выдумывай. Невыполненные задачи прошлых дней в «сегодня» НЕ входят — не приписывай их сегодняшнему дню.\n${lines}`;
      }
      return `\n\nЗАДАЧИ НА СЕГОДНЯ (${todayStr})\nНа сегодня задач нет. Если спросят про сегодня — так и скажи, не выдумывай и не подтягивай задачи других дней.`;
    } catch (e: any) {
      console.warn('[Bot RAG] today tasks inject failed:', e?.message);
    }
    return '';
  })();

  // 4. RAG — каскад vector → keyword → recent (ПОЛИСАД, слой 2).
  // Дневные треды бота исключаются — они идут отдельным блоком «Вчера в боте».
  const ragBlock = (async () => {
    // Гейт: реплики без содержательных слов («да мб», «ещё раз», «понял») архив
    // не трогают — экономим эмбеддинг-вызов (он на критическом пути префилла) и
    // не раздуваем промпт. Личный контекст таким репликам даёт профиль + история.
    if (polisad.extractKeywords(userText).length === 0) {
      return '';
    }
    try {
      const { rows: ragRows, isExplicit } = await polisad.retrieveArchive(
        db, userId, userText, apiKey,
        { vectorEnabled: true, excludeBotThreads: true }
      );
      // Инжектим ТОЛЬКО явное совпадение (vector/keyword). Recent-fallback для бота —
      // шум: он не по запросу, а просто свежие треды, и путал модель («Усталость»
      // на «да мб»). Свежий контекст уже есть в истории треда и блоке «Вчера в боте».
      if (ragRows.length > 0 && isExplicit) {
        const contextBlock = ragRows.map((r: any) => `[${r.title}]\n${r.summary}`).join('\n---\n');
        console.log('[Bot RAG] injected:', ragRows.map((r: any) => r.title));
        return `\n\nИЗ АРХИВА ПОЛЬЗОВАТЕЛЯ\nФрагменты из заметок и прошлых разговоров. Используй как контекст, не упоминай сам факт архива.\n\n${contextBlock}`;
      }
      if (ragRows.length > 0) console.log('[Bot RAG] fallback не инжектим (нет явного совпадения)');
    } catch (e: any) {
      console.warn('[Bot RAG] rag failed:', e?.message);
    }
    return '';
  })();

  const [profile, yesterday, today, upcoming, rag] = await Promise.all([profileBlock, yesterdayBlock, todayBlock, upcomingBlock, ragBlock]);
  return getSystemInstruction(userTz) + profile + yesterday + today + upcoming + rag;
}

async function processWithAI(
  userText: string,
  threadMessages: StoredMessage[],
  db: Pool,
  userId: string,
  apiKey: string,
  sink?: StreamSink
): Promise<{ aiResponse: string; newMessages: StoredMessage[] }> {
  const now = () => new Date().toISOString();
  const userMsg: StoredMessage = { role: 'user', content: userText, time: now() };
  const userTz = await getUserTimezone(db, userId);

  // Один шаг LLM. При наличии sink — стримим текст вживую; если стрим упал,
  // молча откатываемся на обычный (нестриминговый) вызов с его OpenRouter-фоллбеком.
  // Шаги с tool_calls текста не дают — sink остаётся на «печатает…».
  const runStep = async (body: object): Promise<LlmStepResult> => {
    if (sink) {
      try {
        return await callRouterAIStream(apiKey, body, (full) => sink.update(full));
      } catch (e: any) {
        // e.cause — настоящая причина (undici прячет её под generic «fetch failed»):
        // код сети/TLS (ECONNREFUSED, ENOTFOUND, cert, UND_ERR_*), важен для ROUTERAI_DIRECT.
        const cause = e?.cause?.code ?? e?.cause?.message ?? e?.cause;
        console.warn('[Bot] стрим не удался, фоллбек:', e?.message, '| cause:', cause ?? '(нет)');
        const data = await callRouterAI(apiKey, body);
        const m = data.choices[0].message;
        const content = typeof m.content === 'string' ? m.content : '';
        if (content) sink.update(content);
        return { content, tool_calls: m.tool_calls };
      }
    }
    const data = await callRouterAI(apiKey, body);
    const m = data.choices[0].message;
    return { content: typeof m.content === 'string' ? m.content : '', tool_calls: m.tool_calls };
  };
  const systemPrompt = await buildBotSystemPrompt(userText, userId, userTz, db, apiKey);

  const folded = foldOverflowMessages(threadMessages);
  const fullSystemPrompt = folded
    ? `${systemPrompt}\n\nРАНЬШЕ СЕГОДНЯ (краткая сводка того, что пользователь говорил ранее в этот день — не переспрашивай это)\n${folded}`
    : systemPrompt;

  const loopMessages = [
    ...buildSafeHistory(threadMessages),
    { role: 'user' as const, content: userText }
  ];
  const newMessages: StoredMessage[] = [userMsg];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    sink?.typing();
    const msg = await runStep({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'system', content: fullSystemPrompt }, ...loopMessages],
      tools: botTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1024,
      thinking: false,
    });

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
      let text = typeof msg.content === 'string' ? msg.content.trim() : '';
      // Иногда модель возвращает пустой content после tool-цикла. Делаем фоллбек
      // без инструментов, чтобы вытянуть нормальный текстовый ответ.
      if (!text) {
        try {
          sink?.typing();
          const retry = await runStep({
            model: 'deepseek/deepseek-v4-flash',
            messages: [
              { role: 'system', content: getSystemInstruction(userTz) },
              ...loopMessages,
              { role: 'user', content: 'Дай короткий текстовый ответ человеку на основе выполненных действий.' },
            ],
            temperature: 0.7,
            max_tokens: 512,
            thinking: false,
          });
          if (retry.content.trim()) text = retry.content.trim();
        } catch (e: any) {
          console.warn('[Bot] fallback-запрос не удался:', e?.message);
        }
      }
      if (!text) text = 'Готово';
      newMessages.push({ role: 'assistant', content: text, time: now() });
      return { aiResponse: text, newMessages };
    }
  }

  return { aiResponse: 'Готово', newMessages };
}

// ─── Thread management (PostgreSQL) ──────────────────────────────────────────

const botThreadTitle = polisad.botThreadTitle;

async function extractAndSaveUserFacts(userId: string, transcript: string, db: Pool, apiKey: string): Promise<void> {
  // Фильтр: разговор должен содержать личную информацию
  const personalSignals = ['я ', 'мне ', 'моя ', 'мой ', 'моё ', 'работаю', 'хочу', 'планирую', 'занимаюсь', 'строю', 'делаю', 'учусь', 'живу'];
  const hasPersonal = personalSignals.some(s => transcript.toLowerCase().includes(s));
  if (!hasPersonal) return;

  try {
    // Получаем текущий профиль чтобы не дублировать факты
    const { rows: profileRows } = await db.query(
      `SELECT id, summary FROM user_threads
       WHERE user_id = $1 AND title = 'О себе' AND source = 'заметка'
       ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );
    const existingProfile = profileRows[0]?.summary || '';

    const response = await fetch('https://routerai.ru/api/v1/chat/completions', tgFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{
          role: 'user',
          content: `Из этого разговора извлеки факты о пользователе — кто он, чем занимается, какие цели, проекты, привычки, планы. Только то что явно сказано, без домыслов. Формат: короткие тезисы, каждый с новой строки, начиная с "—".

Уже известно о пользователе (не повторяй):
${existingProfile || '(ничего)'}

Разговор:
${transcript.slice(0, 4000)}

Если новых фактов нет — ответь пустой строкой.`
        }],
        max_tokens: 200,
        temperature: 0.2,
        thinking: false,
      }),
    }));

    if (!response.ok) return;
    const data = await response.json();
    const newFacts = data.choices?.[0]?.message?.content?.trim();
    if (!newFacts || newFacts.length < 5) return;

    if (profileRows[0]) {
      // Дописываем к существующему профилю
      const updatedSummary = existingProfile
        ? `${existingProfile}\n${newFacts}`
        : newFacts;
      // Ограничиваем размер ~1500 символами — обрезаем старые факты с начала, новые сохраняем
      const trimmed = updatedSummary.length > 1500
        ? updatedSummary.slice(updatedSummary.length - 1500).replace(/^[^\n]*\n/, '') // не режем посреди строки
        : updatedSummary;
      await db.query(
        `UPDATE user_threads SET summary = $1, updated_at = NOW() WHERE id = $2`,
        [trimmed, profileRows[0].id]
      );
    } else {
      // Создаём тред "О себе" — created_at в user_threads хранится как bigint (ms)
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source, summary, is_meaningful)
         VALUES ($1, $2, 'О себе', '', '[]'::jsonb, $3, NOW(), 'заметка', $4, true)`,
        [id, userId, Date.now(), newFacts]
      );
    }
    console.log(`[Bot] профиль пользователя ${userId} обновлён`);
  } catch (e: any) {
    console.warn('[Bot] извлечение фактов не удалось:', e?.message);
  }
}

// Саммаризирует вчерашний тред — fire-and-forget, не блокирует ответ пользователю.
async function summarizeBotThread(threadId: string, userId: string, messages: StoredMessage[], db: Pool, apiKey: string): Promise<void> {
  await polisad.summarizeBotThread(db, apiKey, threadId, messages, (transcript) => {
    // После саммаризации — извлекаем факты о пользователе (fire-and-forget)
    extractAndSaveUserFacts(userId, transcript, db, apiKey).catch(() => {});
  });
}

async function loadBotThread(
  db: Pool,
  userId: string,
  userTz: string,
  apiKey: string
): Promise<{ id: string; messages: StoredMessage[]; isNew: boolean }> {
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: userTz });
  const todayTitle = botThreadTitle(todayStr);

  // Ищем тред за сегодня
  const { rows } = await db.query(
    `SELECT id, messages FROM user_threads WHERE user_id = $1 AND title = $2 LIMIT 1`,
    [userId, todayTitle]
  );
  if (rows[0]) {
    return { id: rows[0].id, messages: rows[0].messages ?? [], isNew: false };
  }

  // Нового треда нет — создаём только если ещё не существует (атомарная защита от гонки).
  // Не используем ON CONFLICT (user_id, title) — в БД есть дублирующие title у разных тредов.
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source)
     SELECT $1, $2, $3, '', '[]'::jsonb, $4, NOW(), 'telegram'
     WHERE NOT EXISTS (
       SELECT 1 FROM user_threads WHERE user_id = $2 AND title = $3
     )`,
    [id, userId, todayTitle, Date.now()]
  );

  // Саммаризируем вчерашний тред (fire-and-forget)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: userTz });
  const yesterdayTitle = botThreadTitle(yesterdayStr);
  db.query(
    `SELECT id, messages FROM user_threads WHERE user_id = $1 AND title = $2 AND summary IS NULL LIMIT 1`,
    [userId, yesterdayTitle]
  ).then(({ rows: yRows }) => {
    if (yRows[0]) {
      const msgs: StoredMessage[] = yRows[0].messages ?? [];
      const meaningful = msgs.filter(m => m.role !== 'tool' && m.content?.trim());
      if (meaningful.length >= 4) {
        summarizeBotThread(yRows[0].id, userId, msgs, db, apiKey).catch(() => {});
      }
    }
  }).catch(() => {});

  // Читаем то что реально создалось (гонка могла создать тред раньше нас)
  const { rows: created } = await db.query(
    `SELECT id FROM user_threads WHERE user_id = $1 AND title = $2 LIMIT 1`,
    [userId, todayTitle]
  );
  return { id: created[0]?.id ?? id, messages: [], isNew: true };
}

async function saveBotThread(
  db: Pool,
  userId: string,
  threadId: string,
  allMessages: StoredMessage[]
): Promise<void> {
  const preview = allMessages
    .filter(m => m.role !== 'tool')
    .slice(-1)[0]?.content?.slice(0, 80) ?? '';

  await db.query(
    `UPDATE user_threads SET messages = $1::jsonb, preview = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(allMessages), preview, threadId]
  );
}

// Дописывает проактивное сообщение (напоминание, утренняя сводка) в сегодняшний
// тред бота — чтобы модель видела его в истории диалога, когда пользователь
// на него отвечает. Fire-and-forget: ошибки БД не должны ломать отправку в Telegram.
async function appendProactiveToBotThread(
  db: Pool,
  userId: string,
  userTz: string,
  text: string,
  taskId?: string
): Promise<void> {
  try {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: userTz });
    const title = botThreadTitle(todayStr);
    const message: StoredMessage = { role: 'assistant', content: text, time: new Date().toISOString() };
    if (taskId) message.task_id = taskId;

    // Треда за сегодня может ещё не быть (пользователь ничего не писал) —
    // создаём тем же атомарным паттерном, что и loadBotThread, без побочных
    // эффектов саммаризации (для этого не нужен apiKey).
    await db.query(
      `INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source)
       SELECT $1, $2, $3, '', '[]'::jsonb, $4, NOW(), 'telegram'
       WHERE NOT EXISTS (
         SELECT 1 FROM user_threads WHERE user_id = $2 AND title = $3
       )`,
      [crypto.randomUUID(), userId, title, Date.now()]
    );

    // Атомарная jsonb-конкатенация — без read-modify-write, чтобы не потерять
    // параллельные записи ответа пользователя. Пишем ровно в один тред (в БД
    // встречаются дублирующие title — как в loadBotThread берём LIMIT 1),
    // иначе сообщение задвоится по всем совпадениям.
    await db.query(
      `UPDATE user_threads
       SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb,
           preview = $3,
           updated_at = NOW()
       WHERE id = (
         SELECT id FROM user_threads WHERE user_id = $1 AND title = $4 LIMIT 1
       )`,
      [userId, JSON.stringify([message]), text.slice(0, 80), title]
    );
  } catch (e: any) {
    console.error('[Notif] не удалось записать проактивное сообщение в тред:', e?.message);
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

// Финальная отправка ответа Мысли без стрима: пробуем rich (Markdown → структура),
// при любой неудаче — прежнее поведение (чистый текст, побитый на куски ≤4096).
async function sendFinalMessage(token: string, chatId: number, raw: string): Promise<void> {
  const trimmed = (raw || '').trim();
  if (RICH_MESSAGES_ENABLED && trimmed && trimmed.length <= RICH_MAX_LEN) {
    const res = await tgApi(token, 'sendRichMessage', {
      chat_id: chatId, rich_message: { markdown: trimmed },
    }).catch(() => null);
    if (res?.ok) return;
    if (res && !res.ok) console.warn('[Bot] sendRichMessage отклонён:', res.description);
  }
  const clean = cleanBotText(trimmed).trim() || 'Готово';
  for (const part of splitForTelegram(clean)) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: part }).catch(() => {});
  }
}

// ─── Стриминг ответа в Telegram (через editMessageText) ───────────────────────
// Telegram не умеет токеновый поток, поэтому стримим через редактирование одного
// сообщения-плейсхолдера. Лимит правок — ~1/сек на чат, поэтому throttle.
// ВАЖНО: финальный текст коммитится тем же editMessageText, отдельного
// sendMessage в конце НЕТ — иначе сообщение задвоится.

const STREAM_EDIT_THROTTLE_MS = 1200;   // безопасный интервал между правками
const TG_MAX_LEN = 4096;                // лимит длины сообщения Telegram

// Чистим разметку: системный промпт запрещает Markdown, но подстрахуемся.
function cleanBotText(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,3}\s/gm, '');
}

// Бьём длинный текст на куски ≤ TG_MAX_LEN по границам строк/пробелов.
function splitForTelegram(text: string, max = TG_MAX_LEN): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

interface StreamSink {
  update(rawFull: string): void;            // дельта: накопленный сырой текст
  finish(finalRaw: string): Promise<void>;  // финальный коммит (без доп. sendMessage)
  typing(): void;                           // освежить индикатор «печатает…»
}

// Заглушка-плейсхолдер, пока модель молчит до первого токена (в голосе «Мысли»).
const STREAM_PLACEHOLDER = 'Размышляю...';

// Создаёт сток: шлёт «печатает…», ставит сообщение-плейсхолдер и редактирует его.
async function createStreamSink(token: string, chatId: number): Promise<StreamSink> {
  tgApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const sent = await tgApi(token, 'sendMessage', { chat_id: chatId, text: STREAM_PLACEHOLDER });
  const messageId: number | undefined = sent?.result?.message_id;

  let lastSent = STREAM_PLACEHOLDER;
  let pending: string | null = null;
  // ставим «время последней правки» в текущий момент: первая правка подождёт
  // throttle, чтобы не лупить editMessageText сразу после sendMessage (429).
  let lastEditAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let finished = false;
  // Все правки сериализованы через цепочку — никаких параллельных editMessageText,
  // которые могли бы прийти в Telegram не по порядку и оставить устаревший текст.
  let editChain: Promise<void> = Promise.resolve();

  const doEdit = async (raw: string) => {
    if (!messageId || finished) return;  // finish уже взял управление — стрим-правки молчат
    let clean = cleanBotText(raw).trim();
    if (!clean || clean === lastSent) return;
    if (clean.length > TG_MAX_LEN) clean = clean.slice(0, TG_MAX_LEN - 1) + '…';
    lastSent = clean;
    await tgApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: clean })
      .catch(() => { /* 429 / not modified — игнор */ });
  };

  const flush = () => {
    if (pending === null) return;
    const t = pending;
    pending = null;
    // Отмечаем момент правки уже при постановке в очередь — иначе несколько
    // SSE-строк из одного сетевого чанка проскочат троттлинг за один тик.
    lastEditAt = Date.now();
    editChain = editChain.then(() => doEdit(t));
  };

  return {
    update(rawFull: string) {
      if (finished || !messageId) return;
      pending = rawFull;
      const since = Date.now() - lastEditAt;
      if (since >= STREAM_EDIT_THROTTLE_MS) {
        if (timer) { clearTimeout(timer); timer = null; }
        flush();
      } else if (!timer) {
        timer = setTimeout(() => { timer = null; flush(); }, STREAM_EDIT_THROTTLE_MS - since);
      }
    },
    async finish(finalRaw: string) {
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      // Дожидаемся, пока сольются все стрим-правки в полёте — финальная правка
      // должна записаться ПОСЛЕДНЕЙ, иначе устаревшая дельта перетрёт финал.
      await editChain.catch(() => {});

      const raw = (finalRaw || '').trim();
      // Rich-коммит (Markdown → структура на клиенте). Плейсхолдер отправлен как
      // обычный текст, а Telegram НЕ гарантирует конвертацию text→rich через edit,
      // поэтому: 1) пробуем edit (без мигания); 2) если отклонён — шлём свежее
      // rich-сообщение и удаляем плейсхолдер; 3) любой отказ логируем и падаем в текст.
      if (RICH_MESSAGES_ENABLED && raw && raw.length <= RICH_MAX_LEN) {
        if (messageId) {
          const res = await tgApi(token, 'editMessageText', {
            chat_id: chatId, message_id: messageId, rich_message: { markdown: raw },
          }).catch(() => null);
          if (res?.ok) { lastSent = raw; return; }
          if (res && !res.ok) console.warn('[Bot] rich edit отклонён:', res.description);
        }
        const sent = await tgApi(token, 'sendRichMessage', {
          chat_id: chatId, rich_message: { markdown: raw },
        }).catch(() => null);
        if (sent?.ok) {
          if (messageId) tgApi(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
          return;
        }
        if (sent && !sent.ok) console.warn('[Bot] sendRichMessage отклонён:', sent.description);
      }

      const clean = (cleanBotText(finalRaw).trim()) || 'Готово';
      // Плейсхолдер не создался — единственная отправка целиком (задвоения нет).
      if (!messageId) {
        for (const part of splitForTelegram(clean)) {
          await tgApi(token, 'sendMessage', { chat_id: chatId, text: part }).catch(() => {});
        }
        return;
      }
      const parts = splitForTelegram(clean);
      // Первый кусок — в плейсхолдер (если уже совпадает, Telegram сам не тронет).
      if (parts[0] !== lastSent) {
        await tgApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: parts[0] })
          .catch(() => {});
        lastSent = parts[0];
      }
      // Остаток (для длинных ответов) — отдельными сообщениями.
      for (const part of parts.slice(1)) {
        await tgApi(token, 'sendMessage', { chat_id: chatId, text: part }).catch(() => {});
      }
    },
    typing() {
      if (!finished) tgApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    },
  };
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
      console.log(`[Bot] Транскрипция получена, длина: ${userText.length}`);
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
  const userTz = await getUserTimezone(db, webUserId);
  const thread = await loadBotThread(db, webUserId, userTz, apiKey);
  const existingMessages = thread.messages;

  console.log(`[Bot] вызываю AI для ${webUserId}, длина сообщения: ${userText.length}${thread.isNew ? ' [новый тред]' : ''}`);

  // Стрим-сток: плейсхолдер + «печатает…». Если создать не удалось (сеть),
  // работаем по-старому — одной отправкой в конце. Двойной отправки нет ни в одной ветке:
  // при наличии sink финал коммитится через editMessageText, без sink — единственный sendMessage.
  let sink: StreamSink | null = null;
  try {
    sink = await createStreamSink(token, chatId);
  } catch (e: any) {
    console.warn('[Bot] не удалось создать стрим-сток, шлём без стрима:', e?.message);
  }

  try {
    const { aiResponse, newMessages } = await processWithAI(
      userText,
      existingMessages,
      db,
      webUserId,
      apiKey,
      sink ?? undefined
    );
    console.log(`[Bot] AI ответил: "${aiResponse?.slice(0, 80)}"`);
    await saveBotThread(db, webUserId, thread.id, [...existingMessages, ...newMessages]);
    // Сырой ответ (с Markdown) — rich-путь отрендерит его структурой; при откате
    // на чистый текст разметка снимается внутри finish/sendFinalMessage.
    if (sink) await sink.finish(aiResponse ?? '');
    else await sendFinalMessage(token, chatId, aiResponse ?? '');
  } catch (e: any) {
    console.error(`[Bot] ошибка AI:`, e?.message || e);
    const errText = 'Не могу ответить прямо сейчас, попробуй позже.';
    if (sink) await sink.finish(errText);
    else await tgApi(token, 'sendMessage', { chat_id: chatId, text: errText });
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

  // Календарный вид: аддитивно гарантируем колонки (бот — отдельный контейнер от веб-сервера).
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS end_time TEXT`).catch(() => {});
  await polisad.ensurePolisadSchema(db).catch((e: any) => console.warn('[polisad] schema init failed:', e?.message));
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS category TEXT`).catch(() => {});
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS time_source TEXT`).catch(() => {});
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS suggested_time TEXT`).catch(() => {});
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS suggested_end_time TEXT`).catch(() => {});

  // Shared events: дублируем схему (бот — отдельный контейнер от веб-сервера).
  await db.query(`
    CREATE TABLE IF NOT EXISTS shared_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      partner_name TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
  `).catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS shared_event_adds (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, user_id)
    );
  `).catch(() => {});

  // Прогрев соединения к LLM-провайдеру — режет TLS-хендшейк из TTFT.
  startConnectionWarmup();

  // Режим обновлений НЕ зависит от APP_URL: APP_URL нужен веб-серверу для
  // генерации публичных ссылок (shared events), но не должен переключать бота
  // на webhook. Webhook — только по явному опту USE_WEBHOOK=1 (и заданному URL),
  // иначе long-polling, на котором бот работает по умолчанию.
  const useWebhook = process.env.USE_WEBHOOK === '1';
  const appUrl = process.env.APP_URL || null;

  if (useWebhook && appUrl) {
    await setupWebhook(token, appUrl);
  } else {
    console.log('[Bot] long-polling режим (USE_WEBHOOK!=1)');
    startLongPolling(token, db, apiKey);
  }
}

// ─── Notification & Proactive schedulers ────────────────────────────────────

// Колонка proactive_sent_date нужна для дедупликации:
// чтобы не отправить пользователю дважды за один день локальной даты.
async function ensureProactiveColumn(db: Pool): Promise<void> {
  await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS proactive_sent_date TEXT`).catch(() => {});
}

async function sendProactiveMessages(token: string, db: Pool): Promise<void> {
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return;

  try {
    const { rows: users } = await db.query(
      `SELECT p.user_id, p.telegram_chat_id, p.last_active_at, p.proactive_sent_date,
              COALESCE(p.timezone, 'Europe/Moscow') AS timezone,
              p.settings
       FROM user_profiles p
       WHERE p.telegram_chat_id IS NOT NULL
         AND p.last_active_at >= NOW() - INTERVAL '14 days'
         AND COALESCE((p.settings->>'notifs')::boolean, true) = true`
    );

    const now = new Date();
    for (const user of users) {
      try {
        // Запускаем раз в час; для каждого юзера шлём только если у НЕГО локально 12:00.
        const userHour = Number(now.toLocaleString('en-US', { timeZone: user.timezone, hour: '2-digit', hour12: false }));
        if (userHour !== 12) continue;

        const userTodayInTz = now.toLocaleDateString('sv-SE', { timeZone: user.timezone });

        // Дедупликация: уже отправили сегодня — не повторяем.
        if (user.proactive_sent_date === userTodayInTz) continue;
        // Только АКТУАЛЬНЫЕ задачи: на сегодня или будущее. Просроченные — пропускаем.
        const tasksRes = await db.query(
          `SELECT name, date, time FROM user_tasks
           WHERE user_id = $1 AND done = false
             AND date >= $2
           ORDER BY date ASC, time ASC NULLS LAST LIMIT 5`,
          [user.user_id, userTodayInTz]
        );

        // Без актуальных задач — не пишем. Это решает "приходит без задач".
        // Старые треды как контекст больше не используем — они часто устарели.
        if (tasksRes.rows.length === 0) {
          console.log(`[Proactive] ${user.user_id}: нет актуальных задач, пропускаем`);
          continue;
        }

        const taskLines = tasksRes.rows.map((t: any) => {
          const when = t.date === userTodayInTz ? 'сегодня' : t.date;
          return `- ${t.name} (${when}${t.time ? ', ' + t.time : ''})`;
        }).join('\n');

        const prompt = `Ты — Мысль, персональный AI-ассистент. Сгенерируй одно короткое проактивное сообщение пользователю.

Незакрытые задачи на сегодня и далее:
${taskLines}

Правила:
- Максимум 2 предложения, тёплый и человечный тон
- Конкретная отсылка к 1-2 ближайшим задачам по названию
- Не приветствуй ("Доброе утро", "Привет"), сразу к делу
- Никогда: "Как дела?", "Чем могу помочь?"
- Не перечисляй все задачи — выдели самое важное
- Plaintext, без кавычек, без эмодзи, без Markdown`;

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

        // Записываем в тред — как и напоминания, эта сводка отправлена от имени
        // Мысли и должна быть видна модели, если пользователь на неё ответит.
        appendProactiveToBotThread(db, user.user_id, user.timezone, text).catch(e =>
          console.error('[Proactive] append thread error:', e?.message)
        );

        await db.query(
          `UPDATE user_profiles SET proactive_sent_date = $1 WHERE user_id = $2`,
          [userTodayInTz, user.user_id]
        );

        console.log(`[Proactive] Отправлено пользователю ${user.user_id} (${user.timezone}, локальная дата ${userTodayInTz})`);
      } catch (e: any) {
        console.error(`[Proactive] Ошибка для ${user.user_id}:`, e?.message);
      }
    }
  } catch (e: any) {
    console.error('[Proactive] Ошибка:', e?.message);
  }
}

export function startProactiveScheduler(token: string, db: Pool): void {
  // Тикаем каждый час в 0 минут. Для каждого пользователя проверяем его локальное время:
  // если у него сейчас 9:00 и сегодня ещё не отправляли — шлём.
  // Это автоматически обрабатывает любые часовые пояса корректно.
  ensureProactiveColumn(db).catch(e => console.error('[Proactive] init column:', e?.message));

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      sendProactiveMessages(token, db).catch(e => console.error('[Proactive]', e));
      setInterval(() => sendProactiveMessages(token, db).catch(e => console.error('[Proactive]', e)), 60 * 60 * 1000);
    }, delay);
    console.log(`[Proactive] Первый тик в ${next.toISOString()}, далее каждый час`);
  };
  scheduleNext();
}

// Конвертирует локальное время пользователя (date + time строки) в UTC Date.
// Работает корректно при любом TZ сервера (включая UTC в Docker).
// Пример: "2026-05-22", "15:00", "Europe/Moscow" → 2026-05-22T12:00:00.000Z
function localTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  // Парсим как UTC-момент (точка отсчёта)
  const utcGuess = new Date(`${dateStr}T${timeStr}:00Z`);
  // Смотрим какое время показывает Intl.DateTimeFormat в нужной TZ для этого момента
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcGuess);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const asTzMs = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) % 24, Number(get('minute')), Number(get('second'))
  );
  // offset = насколько TZ опережает UTC в этот момент
  const offsetMs = asTzMs - utcGuess.getTime();
  // Возвращаем UTC-эквивалент локального времени пользователя
  return new Date(utcGuess.getTime() - offsetMs);
}

export async function startNotificationScheduler(token: string, db: Pool): Promise<void> {
  const REMIND_BEFORE_MS = 15 * 60 * 1000;
  // Горизонт планирования — насколько вперёд смотрим в БД при каждом сканировании.
  // Должен быть ≥ интервал сканирования, чтобы все задачи успевали запланироваться заранее.
  const HORIZON_MS = 20 * 60 * 1000;
  const SCAN_INTERVAL_MS = 30 * 1000;

  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ`).catch(() => {});
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS remind_notified_at TIMESTAMPTZ`).catch(() => {});

  // Ключ: `${taskId}:${kind}` где kind = 'time' | 'remind'.
  // Хранит timeout-handle и плановое UTC-время — чтобы знать, нужно ли перепланировать при изменении задачи.
  type Scheduled = { handle: NodeJS.Timeout; firesAt: number };
  const scheduled = new Map<string, Scheduled>();

  // Атомарный claim перед отправкой — защита от дублей при перезапуске и параллельных тиках.
  const claimAndFire = async (
    taskId: string,
    kind: 'time' | 'remind',
    chatId: string,
    text: string,
    userId: string,
    userTz: string
  ) => {
    const column = kind === 'time' ? 'notified_at' : 'remind_notified_at';
    const extraCondition = kind === 'remind' ? 'AND remind_at IS NOT NULL' : '';
    try {
      const res = await db.query(
        `UPDATE user_tasks SET ${column} = NOW()
         WHERE id = $1
           AND done = false
           AND (${column} IS NULL OR ${column} < NOW() - INTERVAL '23 hours')
           ${extraCondition}
         RETURNING id`,
        [taskId]
      );
      if (res.rowCount === 0) return;
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, tgFetchOptions({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        }));
        console.log(`[Notif] отправлено (${kind}) task=${taskId}`);
        // Записываем в тред, чтобы модель видела своё же напоминание, если
        // пользователь на него ответит («да, иду», «перенеси на час»).
        // task_id даёт модели прямую привязку к задаче — без угадывания через get_tasks.
        appendProactiveToBotThread(db, userId, userTz, text, taskId).catch(e =>
          console.error('[Notif] append thread error:', e?.message)
        );
      } catch (e: any) {
        await db.query(`UPDATE user_tasks SET ${column} = NULL WHERE id = $1`, [taskId]).catch(() => {});
        console.error(`[Notif] отправка не удалась (${kind}), откатили claim:`, e?.message);
      }
    } catch (e: any) {
      console.error(`[Notif] claim error (${kind}) task=${taskId}:`, e?.message);
    }
  };

  const schedule = (
    key: string,
    fireAtMs: number,
    fn: () => Promise<void>
  ) => {
    const existing = scheduled.get(key);
    if (existing) {
      // Если ничего не поменялось — не трогаем.
      if (Math.abs(existing.firesAt - fireAtMs) < 1000) return;
      clearTimeout(existing.handle);
    }
    const delay = Math.max(0, fireAtMs - Date.now());
    const handle = setTimeout(async () => {
      scheduled.delete(key);
      await fn();
    }, delay);
    scheduled.set(key, { handle, firesAt: fireAtMs });
  };

  const scan = async () => {
    try {
      const nowMs = Date.now();
      const horizonMs = nowMs + HORIZON_MS;

      // ── 1. Задачи со временем: за 15 минут до старта ─────────────────────────
      const { rows: tasks } = await db.query(
        `SELECT t.id, t.name, t.date, t.time, t.user_id, p.telegram_chat_id,
                COALESCE(p.timezone, 'Europe/Moscow') AS timezone
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND (t.notified_at IS NULL OR t.notified_at < NOW() - INTERVAL '23 hours')
           AND t.time IS NOT NULL AND t.time != ''`
      );

      // Просрочку до 5 минут отрабатываем, более старые игнорируем (видимо контейнер лежал давно).
      const STALE_THRESHOLD_MS = 5 * 60 * 1000;

      for (const row of tasks) {
        const tz = row.timezone || 'Europe/Moscow';
        if (!row.date || !row.time || !/^\d{2}:\d{2}$/.test(row.time)) continue;
        const taskUtc = localTimeToUtc(row.date, row.time, tz).getTime();
        const fireAt = taskUtc - REMIND_BEFORE_MS;
        // В прошлом >5 минут — пропуск, в будущем >HORIZON — пропуск.
        if (fireAt < nowMs - STALE_THRESHOLD_MS) continue;
        if (fireAt > horizonMs) continue;
        schedule(`${row.id}:time`, fireAt, () =>
          claimAndFire(row.id, 'time', row.telegram_chat_id,
            `⏰ Через 15 минут: ${row.name}`, row.user_id, tz)
        );
      }

      // ── 2. Плавающие напоминания через remind_at ─────────────────────────────
      const { rows: reminds } = await db.query(
        `SELECT t.id, t.name, t.remind_at, t.user_id, p.telegram_chat_id,
                COALESCE(p.timezone, 'Europe/Moscow') AS timezone
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND t.remind_at IS NOT NULL
           AND (t.remind_notified_at IS NULL OR t.remind_notified_at < t.remind_at)
           AND t.remind_at <= NOW() + make_interval(secs => $1)`,
        [HORIZON_MS / 1000]
      );

      for (const row of reminds) {
        const fireAt = new Date(row.remind_at).getTime();
        if (fireAt < nowMs - STALE_THRESHOLD_MS) continue;
        if (fireAt > horizonMs) continue;
        schedule(`${row.id}:remind`, fireAt, () =>
          claimAndFire(row.id, 'remind', row.telegram_chat_id,
            `🔔 Напоминание: ${row.name}`, row.user_id, row.timezone || 'Europe/Moscow')
        );
      }

      // ── 3. Очистка: если задача исчезла из выборки (выполнена, удалена, перенесена)
      //     — отменяем плановый отстрел. БД-условия выше уже фильтруют изменения.
      const activeKeys = new Set<string>();
      for (const t of tasks) activeKeys.add(`${t.id}:time`);
      for (const r of reminds) activeKeys.add(`${r.id}:remind`);
      for (const [key, s] of scheduled.entries()) {
        // Не отменяем то что уже скоро сработает — могло просто выйти из горизонта.
        if (s.firesAt - nowMs < SCAN_INTERVAL_MS * 2) continue;
        if (!activeKeys.has(key)) {
          clearTimeout(s.handle);
          scheduled.delete(key);
          console.log(`[Notif] отменено: ${key}`);
        }
      }
    } catch (e: any) {
      console.error('[Notif] scan error:', e?.message);
    }
  };

  setInterval(scan, SCAN_INTERVAL_MS);
  scan();
  console.log(`[Notif] Планировщик запущен: сканирование каждые ${SCAN_INTERVAL_MS / 1000}с, горизонт ${HORIZON_MS / 60000}мин, точность отправки ±1с`);
}
