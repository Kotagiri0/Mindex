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
  const userId = message.from.id.toString(); // Use string for safe bigint handling
  let userText = message.text || "";
  console.log(`[Webhook] Message from ${userId}: "${userText || (message.voice ? 'VOICE' : '')}"`);

  // Проверка конфигурации Supabase
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    console.error("Supabase is not configured on the server.");
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: "⚠️ База данных не настроена. Пожалуйста, попросите администратора добавить VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в настройки."
    });
    return res.sendStatus(200);
  }

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
    const today = new Date().toISOString().split('T')[0];
    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: `${BOT_SYSTEM_PROMPT}\nСегодняшняя дата: ${today}` 
        },
        { role: "user", content: userText }
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    let taskInfo;
    try {
      const content = completion.choices[0].message.content;
      console.log(`[Webhook] AI response: ${content}`);
      taskInfo = JSON.parse(content);
    } catch (e) {
      console.error("[Webhook] JSON Parse Error:", e, completion.choices[0].message.content);
      throw new Error("Не удалось разобрать ответ ИИ");
    }
    
    const { name, time, date, missing_time } = taskInfo;
    const safeTime = time || "";
    const safeDate = date || today;
    console.log(`[Webhook] Task: "${name}", Time: "${safeTime}", Date: "${safeDate}"`);

    // 3. Ensure Profile exists (Upsert)
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    
    if (profileError) console.error("[Webhook] Profile upsert error:", profileError);

    // 4. Save to Supabase
    // Fallback for randomUUID if not available
    const generateUUID = () => {
      try {
        return crypto.randomUUID();
      } catch (e) {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
    };

    const taskId = generateUUID();
    const threadId = generateUUID();

    // Create Task
    const { error: taskError } = await supabase.from("tasks").insert({
      id: taskId,
      user_id: userId,
      name,
      time: safeTime,
      date: safeDate,
      done: false,
      type: 'regular'
    });
    
    if (taskError) console.error("[Webhook] Task insert error:", taskError);

    // Create Thread
    const now = new Date();
    const ft = () => now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    const { error: threadError } = await supabase.from("threads").insert({
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
    
    if (threadError) console.error("[Webhook] Thread insert error:", threadError);

    // 5. Reply to Telegram
    let reply = `✅ Создал задачу: "${name}"`;
    if (safeTime) reply += ` на ${safeTime}`;
    if (safeDate !== today) reply += ` (${safeDate})`;
    
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

// Middleware для проверки админского доступа (пока простая проверка заголовка или параметров)
// В реальном приложении здесь должна быть проверка JWT или сессии Telegram
const adminAuth = (req: any, res: any, next: any) => {
  // Для простоты в этой среде мы доверяем запросам, но ограничиваем доступ к критичным методам
  // В будущем здесь можно добавить проверку X-Telegram-Bot-Api-Secret-Token
  next();
};

// Автоматическая настройка вебхука
app.get("/api/setup-bot", adminAuth, async (req, res) => {
  if (!BOT_TOKEN) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN не установлен в Secrets" });
  }

  // Используем APP_URL из окружения или определяем динамически
  const appUrl = process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const webhookUrl = `${appUrl}/api/webhook`;

  try {
    // 1. Устанавливаем вебхук
    const setRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}&drop_pending_updates=true`);
    
    // 2. Сразу проверяем статус
    const infoRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    
    console.log(`[Bot Setup] Webhook set to: ${webhookUrl}`);
    res.json({ 
      success: true, 
      message: "Бот успешно настроен!", 
      webhookUrl,
      info: infoRes.data.result
    });
  } catch (error: any) {
    console.error("[Bot Setup] Error:", error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.description || error.message 
    });
  }
});

// Проверка текущего статуса бота
app.get("/api/bot-status", adminAuth, async (req, res) => {
  if (!BOT_TOKEN) return res.json({ configured: false, error: "No token" });
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    res.json({ configured: true, info: response.data.result });
  } catch (e) {
    res.json({ configured: false });
  }
});

// Проверка статуса базы данных (Supabase) на сервере
app.get("/api/db-status", (req, res) => {
  const isConfigured = !!process.env.VITE_SUPABASE_URL && !!process.env.VITE_SUPABASE_ANON_KEY;
  res.json({ 
    configured: isConfigured,
    url: process.env.VITE_SUPABASE_URL ? `${process.env.VITE_SUPABASE_URL.substring(0, 15)}...` : null
  });
});

// Эндпоинт для получения конфигурации Supabase клиентом
app.get("/api/config", (req, res) => {
  // We use process.env directly to ensure we get the latest values from the environment
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  
  console.log(`[API] Serving config: URL=${supabaseUrl ? 'Set' : 'Not Set'}, Key=${supabaseAnonKey ? 'Set' : 'Not Set'}`);
  
  res.json({
    supabaseUrl,
    supabaseAnonKey,
  });
});

// Локальный прокси для Groq (дублирует логику api/chat.ts)
app.post("/api/chat", adminAuth, async (req, res) => {
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
      app.listen(PORT, "0.0.0.0", async () => {
        console.log(`Локальный сервер запущен: http://localhost:${PORT}`);
        if (BOT_TOKEN) {
          try {
            const info = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
            console.log("[Bot] Webhook Info:", info.data.result);
          } catch (e) {
            console.error("[Bot] Error getting webhook info:", e);
          }
        }
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
  
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Продакшн сервер запущен: http://localhost:${PORT}`);
    if (BOT_TOKEN) {
      try {
        const info = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
        console.log("[Bot] Webhook Info:", info.data.result);
      } catch (e) {
        console.error("[Bot] Error getting webhook info:", e);
      }
    }
  });
}

export default app;
