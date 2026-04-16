import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureAppSchema, requireDb, handleOptions, setCors } from '../_db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, 'POST, DELETE, OPTIONS');

  if (handleOptions(req, res)) {
    return;
  }

  const db = requireDb(res);
  if (!db) {
    return;
  }

  try {
    await ensureAppSchema();

    if (req.method === 'POST') {
      const thread = req.body?.thread;
      const userId = String(req.body?.userId || '').trim();
      if (!userId || !thread?.id) {
        return res.status(400).json({ error: 'Некорректные данные треда.' });
      }

      await db.query(
        `
          INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            title = EXCLUDED.title,
            preview = EXCLUDED.preview,
            messages = EXCLUDED.messages,
            created_at = EXCLUDED.created_at,
            updated_at = NOW()
        `,
        [
          String(thread.id),
          userId,
          String(thread.title || 'Новая мысль'),
          String(thread.preview || ''),
          JSON.stringify(thread.messages || []),
          Number(thread.createdAt || Date.now()),
        ],
      );

      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '').trim();
      const userId = String(req.query.userId || '').trim();
      if (!id || !userId) {
        return res.status(400).json({ error: 'id и userId обязательны.' });
      }

      await db.query('DELETE FROM user_threads WHERE id = $1 AND user_id = $2', [id, userId]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    if (req.method === 'DELETE') {
      return res.status(500).json({ error: 'Не удалось удалить тред.' });
    }
    return res.status(500).json({ error: 'Не удалось сохранить тред.' });
  }
}
