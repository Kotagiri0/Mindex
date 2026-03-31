import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(200).json({ configured: false, error: "No token" });
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    res.status(200).json({ configured: true, info: response.data.result });
  } catch (e) {
    res.status(200).json({ configured: false });
  }
}
