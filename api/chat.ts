import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from "groq-sdk";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS для Telegram WebView
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  console.log(`[API] Request received: ${req.method} from ${req.headers['user-agent']}`);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Chat API is running' });
  }

  // Разрешаем только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Базовая проверка на авторизацию (можно расширить)
  // В Telegram WebView можно проверять initData
  const authHeader = req.headers.authorization;
  if (!authHeader && process.env.NODE_ENV === 'production') {
    // В продакшене требуем хотя бы наличие заголовка (заглушка)
    // return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;
    
    // Берем ключ из переменных окружения Vercel
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      console.error("GROQ_API_KEY is missing in Vercel environment");
      return res.status(500).json({ 
        error: "На сервере не настроен API ключ Groq. Пожалуйста, добавьте GROQ_API_KEY в настройках Vercel." 
      });
    }

    const groq = new Groq({ apiKey });
    
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

    return res.status(200).json(chatCompletion.choices[0].message);
  } catch (error: any) {
    console.error("Groq API Error:", error);
    return res.status(500).json({ 
      error: error.message || "Произошла внутренняя ошибка сервера при запросе к ИИ." 
    });
  }
}
