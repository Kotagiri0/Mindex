import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureAppSchema, requireDb, handleOptions, setCors } from '../_db';

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

  const userId = String(req.body?.userId || '').trim();
  const settings = req.body?.settings || { agent: true, confirm: true, notifs: true };
  const onboardingComplete = Boolean(req.body?.onboarding_complete);

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен.' });
  }

  try {
    await ensureAppSchema();

    await db.query(
      `
        INSERT INTO user_profiles (user_id, settings, onboarding_complete, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          onboarding_complete = EXCLUDED.onboarding_complete,
          updated_at = NOW()
      `,
      [userId, JSON.stringify(settings), onboardingComplete],
    );

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Не удалось сохранить профиль.' });
  }
}
