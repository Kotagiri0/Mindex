import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Принимать POST-запросы от Telegram webhook
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!BOT_TOKEN || !supabaseUrl || !supabaseAnonKey) {
    console.error("Missing environment variables");
    return res.status(200).end();
  }

  // 2. Парсить тело: message.from.id (telegram_id) и message.text
  const { message } = req.body;
  if (!message || !message.text || !message.from) {
    return res.status(200).end();
  }

  const telegramId = message.from.id;
  const text = message.text;
  const chatId = message.chat.id;

  // 3. Если text начинается с "/" — игнорировать, вернуть 200
  if (text.startsWith('/')) {
    return res.status(200).end();
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // 4. Иначе — вставить в таблицу tasks: { user_id: message.from.id, name: message.text, date: сегодня в формате YYYY-MM-DD, done: false }
    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase.from("tasks").insert({
      user_id: telegramId.toString(),
      name: text,
      date: today,
      done: false
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(200).end();
    }

    // 5. Ответить пользователю через Telegram sendMessage: "✅ Задача добавлена!"
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "✅ Задача добавлена!"
    });

    // 6. Вернуть 200
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Telegram webhook handler error:", error);
    return res.status(200).end();
  }
}
