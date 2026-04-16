import type { VercelRequest, VercelResponse } from '@vercel/node';
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

  if (!username || !password) {
    return res.status(400).json({ error: 'Укажи имя пользователя и пароль.' });
  }

  try {
    await ensureAppSchema();

    const result = await db.query(
      `
        SELECT id, username, display_name, password_hash, provider, email, avatar_url, created_at
        FROM auth_users
        WHERE username = $1
        LIMIT 1
      `,
      [username],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }

    const user = result.rows[0];
    const passwordHash = hashPassword(username, password);

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: 'Неверный пароль.' });
    }

    return res.status(200).json({
      user: formatAuthUser(user),
    });
  } catch {
    return res.status(500).json({ error: 'Не удалось выполнить вход.' });
  }
}
