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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!BOT_TOKEN || !GROQ_API_KEY || !supabaseUrl || !supabaseAnonKey) {
    console.error("Missing configuration in Vercel environment");
    return res.status(200).end(); // Always return 200 to Telegram
  }

  const { message } = req.body;
  if (!message || (!message.text && !message.voice)) return res.status(200).end();

  const chatId = message.chat.id;
  const userId = message.from.id.toString();
  let userText = message.text || "";

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const groq = new Groq({ apiKey: GROQ_API_KEY });

  try {
    // 1. Handle Voice
    if (message.voice) {
      const fileId = message.voice.file_id;
      const fileRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const filePath = fileRes.data.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      
      const audioRes = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const formData = new FormData();
      formData.append("file", Buffer.from(audioRes.data), "voice.ogg");
      formData.append("model", "whisper-large-v3");

      const transcription = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
      });
      userText = transcription.data.text;
    }

    // 2. Extract Task Info
    const today = new Date().toISOString().split('T')[0];
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: `${BOT_SYSTEM_PROMPT}\nСегодняшняя дата: ${today}` },
        { role: "user", content: userText }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const taskInfo = JSON.parse(completion.choices[0].message.content || "{}");
    const { name, time, date, missing_time } = taskInfo;
    const safeTime = time || "";
    const safeDate = date || today;

    // 3. Upsert Profile
    await supabase.from("profiles").upsert({ id: userId, updated_at: new Date().toISOString() }, { onConflict: 'id' });

    // 4. Save Task and Thread
    const generateUUID = () => crypto.randomUUID();
    const taskId = generateUUID();
    const threadId = generateUUID();

    await supabase.from("tasks").insert({
      id: taskId, user_id: userId, name, time: safeTime, date: safeDate, done: false, type: 'regular'
    });

    const now = new Date();
    const ft = () => now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    await supabase.from("threads").insert({
      id: threadId,
      user_id: userId,
      title: name,
      preview: userText,
      messages: [
        { role: "user", content: userText, time: ft() },
        { role: "assistant", content: `Создал задачу: ${name}${safeTime ? ' на ' + safeTime : ''}.`, time: ft() }
      ],
      created_at: now.toISOString()
    });

    // 5. Reply to Telegram
    let reply = `✅ Создал задачу: "${name}"`;
    if (safeTime) reply += ` на ${safeTime}`;
    if (safeDate !== today) reply += ` (${safeDate})`;
    if (missing_time) reply += `\n\n💡 Я не уверен насчёт времени. Если нужно другое — просто напиши мне!`;

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Webhook error:", error);
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "❌ Произошла ошибка при обработке задачи. Попробуй ещё раз."
    });
    return res.status(200).end();
  }
}
