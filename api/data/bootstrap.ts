import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureAppSchema, requireDb, handleOptions, setCors } from '../_db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, 'GET, OPTIONS');

  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = requireDb(res);
  if (!db) {
    return;
  }

  const userId = String(req.query.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен.' });
  }

  try {
    await ensureAppSchema();

    const [profileRes, tasksRes, threadsRes] = await Promise.all([
      db.query(
        `
          SELECT user_id, settings, onboarding_complete, updated_at
          FROM user_profiles
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId],
      ),
      db.query(
        `
          SELECT id, name, time, date, done, type, subtasks
          FROM user_tasks
          WHERE user_id = $1
          ORDER BY updated_at DESC, created_at DESC
        `,
        [userId],
      ),
      db.query(
        `
          SELECT id, title, preview, messages, created_at
          FROM user_threads
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId],
      ),
    ]);

    const profileRow = profileRes.rows[0] || null;

    return res.status(200).json({
      profile: profileRow
        ? {
            settings: profileRow.settings,
            onboarding_complete: profileRow.onboarding_complete,
            updated_at: profileRow.updated_at,
          }
        : null,
      tasks: tasksRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        time: row.time || '',
        date: row.date,
        done: row.done,
        type: row.type || 'regular',
        subtasks: row.subtasks || [],
      })),
      threads: threadsRes.rows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: row.preview,
        messages: row.messages || [],
        createdAt: Number(row.created_at),
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Не удалось загрузить данные пользователя.' });
  }
}
