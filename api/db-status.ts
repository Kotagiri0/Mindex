import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDbPool } from './_db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasDatabaseUrl = !!process.env.DATABASE_URL;

  if (!hasDatabaseUrl) {
    return res.status(200).json({
      configured: false,
      connected: false,
      error: 'DATABASE_URL не задан.',
    });
  }

  const db = getDbPool();
  if (!db) {
    return res.status(200).json({
      configured: false,
      connected: false,
      error: 'Не удалось инициализировать пул pg.',
    });
  }

  try {
    await db.query('SELECT 1');
    return res.status(200).json({
      configured: true,
      connected: true,
    });
  } catch (error: any) {
    return res.status(200).json({
      configured: true,
      connected: false,
      error: error?.message || 'Ошибка подключения к PostgreSQL.',
    });
  }
}
