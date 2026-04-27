import type { VercelRequest, VercelResponse } from '@vercel/node';

const ROUTERAI_BASE = 'https://routerai.ru/api/v1';
const ROUTERAI_MODEL = 'deepseek/deepseek-v4-flash';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  console.log(`[API] Request received: ${req.method} from ${req.headers['user-agent']}`);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Chat API is running' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;

    const apiKey = process.env.ROUTERAI_API_KEY;

    if (!apiKey) {
      console.error('ROUTERAI_API_KEY is missing');
      return res.status(500).json({ error: 'На сервере не настроен API ключ RouterAI. Добавьте ROUTERAI_API_KEY в переменные окружения.' });
    }

    const response = await fetch(`${ROUTERAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ROUTERAI_MODEL,
        messages: [
          { role: 'system', content: systemInstruction },
          ...messages,
        ],
        tools,
        tool_choice: tool_choice || 'auto',
        temperature: 0.7,
        max_tokens: 1024,
        thinking: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('RouterAI error:', response.status, text);
      return res.status(500).json({ error: `RouterAI вернул ошибку ${response.status}: ${text}` });
    }

    const data = await response.json();
    return res.status(200).json(data.choices[0].message);
  } catch (error: any) {
    console.error('RouterAI API Error:', error);
    return res.status(500).json({ error: error.message || 'Произошла внутренняя ошибка сервера при запросе к ИИ.' });
  }
}
