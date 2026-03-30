import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || "",
  process.env.VITE_SUPABASE_ANON_KEY || ""
);

app.use(cors());
app.use(express.json());

// Logging middleware for API requests
app.use("/api/*", (req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

// Telegram Bot Integration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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

app.post("/api/webhook", async (req, res) => {
  if (!BOT_TOKEN || !GROQ_API_KEY) {
    console.error("Missing tokens for bot");
    return res.sendStatus(200);
  }

  const { message } = req.body;
  if (!message || (!message.text && !message.voice)) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userId = message.from.id.toString();
  let userText = message.text || "";

  try {
    const groq = new Groq({ apiKey: GROQ_API_KEY });

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
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: BOT_SYSTEM_PROMPT },
        { role: "user", content: userText }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const taskInfo = JSON.parse(completion.choices[0].message.content);
    const { name, time, date, missing_time } = taskInfo;

    // 3. Ensure Profile exists (Upsert)
    await supabase.from("profiles").upsert({
      id: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    // 4. Save to Supabase
    const taskId = crypto.randomUUID();
    const threadId = crypto.randomUUID();

    // Create Task
    await supabase.from("tasks").insert({
      id: taskId,
      user_id: userId,
      name,
      time,
      date,
      done: false
    });

    // Create Thread
    const now = new Date();
    const ft = () => now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    await supabase.from("threads").insert({
      id: threadId,
      user_id: userId,
      title: name,
      preview: userText,
      messages: [
        { role: "user", content: userText, time: ft() },
        { role: "assistant", content: `Создал задачу: ${name}${time ? ' на ' + time : ''}.`, time: ft() }
      ],
      created_at: now.toISOString()
    });

    // 5. Reply to Telegram
    let reply = `✅ Создал задачу: "${name}"`;
    if (time) reply += ` на ${time}`;
    if (date !== new Date().toISOString().split('T')[0]) reply += ` (${date})`;
    
    if (missing_time) {
      reply += `\n\n💡 Я не уверен насчёт времени. Если нужно другое — просто напиши мне!`;
    }

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });

  } catch (error) {
    console.error("Webhook error:", error);
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "❌ Произошла ошибка при обработке задачи. Попробуй ещё раз."
    });
  }

  res.sendStatus(200);
});

// Health check
app.get("/api/chat", (req, res) => {
  res.json({ status: "ok", message: "Local Chat API is running" });
});

// Локальный прокси для Groq (дублирует логику api/chat.ts)
app.post("/api/chat", async (req, res) => {
  console.log("Локальный запрос к ИИ (POST /api/chat)...");
  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;
    console.log(`Получено сообщений: ${messages?.length || 0}`);
    
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("GROQ_API_KEY отсутствует в .env");
      return res.status(500).json({ 
        error: "Локальный сервер: GROQ_API_KEY не найден. Добавьте его в настройки (Settings -> Secrets)." 
      });
    }

    const groq = new Groq({ apiKey });
    
    console.log("Отправка запроса в Groq API...");
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction },
        ...messages
      ],
      model: "llama-3.3-70b-versatile",
      tools,
      tool_choice: tool_choice || "auto",
      temperature: 0.7,
      max_tokens: 1024,
    });

    console.log("Ответ от Groq получен успешно.");
    if (!chatCompletion.choices || chatCompletion.choices.length === 0) {
      throw new Error("Groq вернул пустой список вариантов (choices).");
    }

    res.json(chatCompletion.choices[0].message);
  } catch (error: any) {
    console.error("Ошибка локального прокси:", error);
    res.status(500).json({ error: error.message || "Ошибка сервера" });
  }
});

// Настройка для разработки (Vite Middleware)
if (process.env.NODE_ENV !== "production") {
  const startDevServer = async () => {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Локальный сервер запущен: http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("Ошибка запуска Vite:", err);
    }
  };
  startDevServer();
} else {
  // Настройка для продакшена (Cloud Run / Docker)
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return;
    res.sendFile(path.join(distPath, 'index.html'));
  });
  
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Продакшн сервер запущен: http://localhost:${PORT}`);
  });
}

export default app;
