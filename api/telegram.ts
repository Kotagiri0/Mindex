import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import Groq from "groq-sdk";
import crypto from "crypto";

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

// ─── System prompt (mirrors src/lib/groq.ts, adapted for bot) ────────────────

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

// ─── Tools (mirrors src/lib/groq.ts, without start_planning) ─────────────────

const botTools: any[] = [
  {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Получить список задач пользователя.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Дата YYYY-MM-DD. Если не указана — вернуть все задачи." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Добавить новую задачу.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Название задачи." },
          time: { type: "string", description: "Время HH:MM (необязательно)." },
          date: { type: "string", description: "Дата YYYY-MM-DD. По умолчанию — сегодня." }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Обновить задачу (имя, время, дату, статус выполнения).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID задачи." },
          done: { type: "boolean", description: "Статус выполнения." },
          name: { type: "string", description: "Новое название." },
          time: { type: "string", description: "Новое время HH:MM." },
          date: { type: "string", description: "Новая дата YYYY-MM-DD." }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Удалить задачу.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID задачи." }
        },
        required: ["id"]
      }
    }
  }
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, args: any, supabase: SupabaseClient, userId: number): Promise<any> {
  const today = new Date().toISOString().split('T')[0];

  switch (name) {
    case 'get_tasks': {
      let q = supabase.from('tasks').select('id, name, time, date, done, type').eq('user_id', userId);
      if (args.date) q = q.eq('date', args.date);
      const { data, error } = await q.order('created_at', { ascending: false });
      return error ? { error: error.message } : (data ?? []);
    }
    case 'add_task': {
      const { data, error } = await supabase.from('tasks').insert({
        user_id: userId,
        name: args.name,
        time: args.time ?? null,
        date: args.date ?? today,
        done: false,
        type: 'regular'
      }).select('id').single();
      return error ? { error: error.message } : { success: true, id: data?.id };
    }
    case 'update_task': {
      const updates: any = {};
      if (args.done !== undefined) updates.done = args.done;
      if (args.name) updates.name = args.name;
      if (args.time) updates.time = args.time;
      if (args.date) updates.date = args.date;
      const { error } = await supabase.from('tasks').update(updates).eq('id', args.id).eq('user_id', userId);
      return error ? { error: error.message } : { success: true };
    }
    case 'delete_task': {
      const { error } = await supabase.from('tasks').delete().eq('id', args.id).eq('user_id', userId);
      return error ? { error: error.message } : { success: true };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// ─── AI processing with tool loop ────────────────────────────────────────────

function toGroqFormat(msgs: StoredMessage[]) {
  return msgs.map(m => {
    const msg: any = { role: m.role, content: m.content ?? '' };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    return msg;
  });
}

async function processWithAI(
  userText: string,
  threadMessages: StoredMessage[],
  supabase: SupabaseClient,
  userId: number,
  groq: Groq
): Promise<{ aiResponse: string; newMessages: StoredMessage[] }> {
  const now = () => new Date().toISOString();
  const userMsg: StoredMessage = { role: 'user', content: userText, time: now() };

  const loopMessages = [
    ...toGroqFormat(threadMessages.slice(-CONTEXT_WINDOW)),
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
        content: msg.content ?? '',
        time: now(),
        tool_calls: msg.tool_calls
      };
      loopMessages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      newMessages.push(assistantEntry);

      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments ?? '{}');
        const result = await executeTool(toolCall.function.name, args, supabase, userId);
        const toolEntry: StoredMessage = {
          role: 'tool',
          content: JSON.stringify(result),
          time: now(),
          tool_call_id: toolCall.id
        };
        loopMessages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
        newMessages.push(toolEntry);
      }
    } else {
      const text = msg.content ?? 'Не могу ответить прямо сейчас.';
      newMessages.push({ role: 'assistant', content: text, time: now() });
      return { aiResponse: text, newMessages };
    }
  }

  return { aiResponse: 'Не удалось обработать запрос.', newMessages };
}

// ─── Thread management ────────────────────────────────────────────────────────

async function loadBotThread(supabase: SupabaseClient, userId: number) {
  const { data } = await supabase
    .from('threads')
    .select('id, messages')
    .eq('user_id', userId)
    .eq('title', BOT_THREAD_TITLE)
    .maybeSingle();
  return data as { id: string; messages: StoredMessage[] } | null;
}

async function saveBotThread(
  supabase: SupabaseClient,
  userId: number,
  threadId: string | null,
  allMessages: StoredMessage[]
) {
  const preview = allMessages
    .filter(m => m.role !== 'tool')
    .slice(-1)[0]?.content?.slice(0, 80) ?? '';

  if (threadId) {
    await supabase.from('threads').update({ messages: allMessages, preview }).eq('id', threadId);
  } else {
    await supabase.from('threads').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      title: BOT_THREAD_TITLE,
      preview,
      messages: allMessages,
      created_at: new Date().toISOString()
    });
  }
}

// ─── Profile registration ─────────────────────────────────────────────────────

async function ensureProfile(supabase: SupabaseClient, userId: number) {
  await supabase
    .from('profiles')
    .upsert(
      { id: userId, settings: { agent: true, confirm: true, notifs: true }, onboarding_complete: false },
      { onConflict: 'id', ignoreDuplicates: true }
    );
}

// ─── Telegram API helper ──────────────────────────────────────────────────────

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tgApi(token: string, method: string, body: any) {
  return axios.post(`https://api.telegram.org/bot${token}/${method}`, body);
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleStart(token: string, chatId: number, firstName: string, supabase: SupabaseClient, userId: number) {
  await ensureProfile(supabase, userId);
  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Привет, ${firstName}! Я Мысль — твой персональный помощник по планированию.\n\nПросто напиши что думаешь, и я помогу разобраться с задачами. Например:\n"Встреча с командой завтра в 10"\n"Что у меня на сегодня?"\n\n/tasks — показать задачи на сегодня`
  });
}

async function handleTasks(token: string, chatId: number, supabase: SupabaseClient, userId: number) {
  const today = new Date().toISOString().split('T')[0];
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, name, time')
    .eq('user_id', userId)
    .eq('date', today)
    .eq('done', false)
    .order('time', { ascending: true, nullsFirst: false });

  if (!tasks || tasks.length === 0) {
    await tgApi(token, 'sendMessage', { chat_id: chatId, text: '✨ На сегодня задач нет.' });
    return;
  }

  const lines = tasks.map((t: { id: string; name: string; time: string | null }, i: number) => {
    const time = t.time ? ` — <b>${escapeHtml(t.time)}</b>` : '';
    return `${i + 1}. <b>${escapeHtml(t.name)}</b>${time}`;
  }).join('\n');

  const inline_keyboard = tasks.map((t: { id: string; name: string; time: string | null }) => ([{
    text: `✓ ${t.name.slice(0, 32)}`,
    callback_data: `done:${t.id}`
  }]));

  await tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `📋 <b>Задачи на сегодня:</b>\n\n${lines}`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });
}

async function handleCallback(cq: TgCallbackQuery, token: string, supabase: SupabaseClient) {
  if (!cq.data?.startsWith('done:')) {
    await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  const taskId = cq.data.slice(5);
  await supabase.from('tasks').update({ done: true }).eq('id', taskId).eq('user_id', cq.from.id);

  await tgApi(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: '✅ Выполнено!' });

  // Remove completed task's button from the keyboard
  const origKeyboard = cq.message.reply_markup?.inline_keyboard ?? [];
  const newKeyboard = origKeyboard.filter(row =>
    !row.some((btn: any) => btn.callback_data === cq.data)
  );
  await tgApi(token, 'editMessageReplyMarkup', {
    chat_id: cq.message.chat.id,
    message_id: cq.message.message_id,
    reply_markup: { inline_keyboard: newKeyboard }
  }).catch(() => {}); // ignore if message is too old to edit
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!BOT_TOKEN || !supabaseUrl || !supabaseKey || !groqKey) {
    console.error('[Bot] Missing env vars:', {
      BOT_TOKEN: !!BOT_TOKEN,
      supabaseUrl: !!supabaseUrl,
      supabaseKey: !!supabaseKey,
      groqKey: !!groqKey,
    });
    return res.status(200).end();
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const groq = new Groq({ apiKey: groqKey });
  const update = req.body;

  // Inline keyboard callback (✓ Выполнено button)
  if (update.callback_query) {
    try {
      await handleCallback(update.callback_query as TgCallbackQuery, BOT_TOKEN, supabase);
    } catch (e) {
      console.error('[Bot] Callback error:', e);
    }
    return res.status(200).end();
  }

  const message: TgMessage = update.message;
  if (!message?.from || !message.text) return res.status(200).end();

  const { id: userId, first_name } = message.from;
  const chatId = message.chat.id;
  const text = message.text;

  try {
    if (text === '/start') {
      await handleStart(BOT_TOKEN, chatId, first_name, supabase, userId);
      return res.status(200).end();
    }

    if (text === '/tasks') {
      await ensureProfile(supabase, userId);
      await handleTasks(BOT_TOKEN, chatId, supabase, userId);
      return res.status(200).end();
    }

    // All other messages → AI (Мысль)
    await ensureProfile(supabase, userId);

    const thread = await loadBotThread(supabase, userId);
    const existingMessages = thread?.messages ?? [];

    const { aiResponse, newMessages } = await processWithAI(
      text,
      existingMessages,
      supabase,
      userId,
      groq
    );

    await saveBotThread(supabase, userId, thread?.id ?? null, [...existingMessages, ...newMessages]);

    await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: aiResponse });
  } catch (e) {
    console.error('[Bot] Handler error:', e);
    await tgApi(BOT_TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: 'Что-то пошло не так. Попробуй ещё раз.'
    }).catch(() => {});
  }

  return res.status(200).end();
}
