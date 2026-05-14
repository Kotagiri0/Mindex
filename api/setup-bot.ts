import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from "axios";
import { BOT_COMMANDS } from "./bot-commands";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN не установлен в Secrets" });
  }

  // На Vercel мы используем VERCEL_URL или переданный хост
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const appUrl = `${protocol}://${host}`;
  const webhookUrl = `${appUrl}/api/telegram`;

  try {
    // 1. Устанавливаем вебхук
    await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}&drop_pending_updates=true`);

    // 2. Регистрируем команды в меню Telegram
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      commands: BOT_COMMANDS,
    });

    // 3. Проверяем статус
    const infoRes = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);

    console.log(`[Bot Setup] Webhook set to: ${webhookUrl}`);
    res.status(200).json({
      success: true,
      message: "Бот успешно настроен!",
      webhookUrl,
      info: infoRes.data.result,
    });
  } catch (error: any) {
    console.error("[Bot Setup] Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || error.message,
    });
  }
}

