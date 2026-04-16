import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from "groq-sdk";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const BOT_SYSTEM_PROMPT = `Ты — ассистент по планированию задач. Твоя цель — извлечь название задачи, время и дату из сообщения пользователя.
Если время не указано, постарайся угадать его из контекста (например, "утром" -> 09:00, "вечером" -> 18:00) или оставь пустым.
Если дата не указана, считай, что это сегодня.
Отвечай СТРОГО в формате JSON:
{
  "name": "название задачи",
  "time": "ЧЧ:ММ",
  "date": "ГГГГ-ММ-ДД",
  "missing_time": true/false
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!BOT_TOKEN || !supabaseUrl || !supabaseAnonKey) return res.status(200).end();

  const { message } = req.body;
  if (!message || !message.text || message.text.startsWith('/')) return res.status(200).end();

  const chatId = message.chat.id;
  const telegramId = message.from.id;
  const text = message.text;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const today = new Date().toISOString().split('T')[0];

    // Вставляем в существующую таблицу tasks
    await supabase.from("tasks").insert({
      user_id: telegramId.toString(),
      name: text,
      date: today,
      done: false,
      type: 'regular'
    });

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "✅ Задача добавлена!"
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(200).end();
  }
}
