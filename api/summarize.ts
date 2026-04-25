import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY missing' });

  try {
    const groq = new Groq({ apiKey });

    const dialogText = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => `${m.role === 'user' ? 'Пользователь' : 'Мысль'}: ${m.content}`)
      .join('\n');

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Ты — Мысль, персональный ИИ-ассистент. Твоя задача: кратко и структурированно изложить суть диалога.
Формат ответа:
**Суть:** одно предложение — о чём был разговор.
**Ключевые тезисы:** 2–4 буллет-пункта с главными мыслями и решениями.
Пиши по-русски, кратко, без воды. Не упоминай себя и не используй вводных фраз.`,
        },
        {
          role: 'user',
          content: `Вот диалог:\n\n${dialogText}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content || '';
    return res.status(200).json({ summary });
  } catch (err: any) {
    console.error('[summarize]', err);
    return res.status(500).json({ error: err.message || 'Failed to summarize' });
  }
}
