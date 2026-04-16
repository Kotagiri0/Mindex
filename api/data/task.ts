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
      const task = req.body?.task;
      const userId = String(req.body?.userId || '').trim();
      if (!userId || !task?.id || !task?.name || !task?.date) {
        return res.status(400).json({ error: 'Некорректные данные задачи.' });
      }

      await db.query(
        `
          INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            name = EXCLUDED.name,
            time = EXCLUDED.time,
            date = EXCLUDED.date,
            done = EXCLUDED.done,
            type = EXCLUDED.type,
            subtasks = EXCLUDED.subtasks,
            updated_at = NOW()
        `,
        [
          String(task.id),
          userId,
          String(task.name),
          String(task.time || ''),
          String(task.date),
          Boolean(task.done),
          String(task.type || 'regular'),
          JSON.stringify(task.subtasks || []),
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

      await db.query('DELETE FROM user_tasks WHERE id = $1 AND user_id = $2', [id, userId]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    if (req.method === 'DELETE') {
      return res.status(500).json({ error: 'Не удалось удалить задачу.' });
    }
    return res.status(500).json({ error: 'Не удалось сохранить задачу.' });
  }
}
