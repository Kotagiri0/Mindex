import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { ensureAppSchema, formatAuthUser, hashPassword, normalizeUsername, requireDb, handleOptions, setCors } from '../_db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, 'POST, OPTIONS');

  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = requireDb(res);
  if (!db) {
    return;
  }

  const username = normalizeUsername(String(req.body?.username || ''));
  const password = String(req.body?.password || '');
  const rawDisplayName = String(req.body?.displayName || '').trim();
  const displayName = rawDisplayName || username;

  if (!username || !password) {
    return res.status(400).json({ error: 'Укажи имя пользователя и пароль.' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Имя пользователя должно быть не короче 3 символов.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов.' });
  }

  try {
    await ensureAppSchema();

    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(username, password);

    const result = await db.query(
      `
        INSERT INTO auth_users (id, username, display_name, password_hash, provider)
        VALUES ($1, $2, $3, $4, 'local')
        RETURNING id, username, display_name, created_at, provider, email, avatar_url
      `,
      [userId, username, displayName, passwordHash],
    );

    return res.status(201).json({
      user: formatAuthUser(result.rows[0]),
    });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Такой пользователь уже существует.' });
    }
    return res.status(500).json({ error: 'Не удалось зарегистрировать пользователя.' });
  }
}
