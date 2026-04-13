import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { Pool } from 'pg';
import { verifyGoogleIdToken } from '../../src/lib/google-auth.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const formatAuthUser = (user: any) => ({
  id: String(user.id),
  username: String(user.username),
  displayName: String(user.display_name ?? user.displayName ?? ''),
  createdAt: new Date(user.created_at ?? user.createdAt ?? Date.now()).getTime(),
  provider: user.provider === 'google' ? 'google' : 'local',
  email: user.email ? String(user.email) : undefined,
  avatarUrl: user.avatar_url ? String(user.avatar_url) : undefined,
});

const ensureAuthSchema = async () => {
  if (!db) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      google_sub TEXT,
      email TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'local';`);
  await db.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS google_sub TEXT;`);
  await db.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email TEXT;`);
  await db.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS auth_users_google_sub_key ON auth_users (google_sub) WHERE google_sub IS NOT NULL;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_key ON auth_users (email) WHERE email IS NOT NULL;`);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!db) {
    return res.status(500).json({ error: 'База данных не настроена (DATABASE_URL).' });
  }

  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google client id не настроен на сервере.' });
  }

  const credential = String(req.body?.credential || '').trim();
  if (!credential) {
    return res.status(400).json({ error: 'Google credential обязателен.' });
  }

  try {
    await ensureAuthSchema();

    const payload = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID);
    const email = String(payload.email || '').trim().toLowerCase();
    const displayName = (payload.name || payload.given_name || email.split('@')[0] || 'Google User').trim();
    let username = email || `google-${payload.sub.slice(0, 12)}`;

    if (email) {
      const usernameExists = await db.query(
        `SELECT id FROM auth_users WHERE username = $1 LIMIT 1`,
        [username]
      );

      if (usernameExists.rows.length > 0) {
        username = `google-${payload.sub.slice(0, 12)}`;
      }
    }

    const existing = await db.query(
      `
        SELECT id, username, display_name, provider, email, avatar_url, created_at
        FROM auth_users
        WHERE google_sub = $1 OR ($2 <> '' AND email = $2)
        LIMIT 1
      `,
      [payload.sub, email]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];

      await db.query(
        `
          UPDATE auth_users
          SET provider = 'google',
              google_sub = COALESCE(google_sub, $1),
              email = COALESCE(email, $2),
              avatar_url = COALESCE($3, avatar_url),
              display_name = COALESCE(NULLIF(display_name, ''), $4)
          WHERE id = $5
        `,
        [payload.sub, email || null, payload.picture || null, displayName, row.id]
      );

      return res.status(200).json({
        user: formatAuthUser({
          ...row,
          provider: 'google',
          email: row.email || email || null,
          avatar_url: row.avatar_url || payload.picture || null,
        }),
      });
    }

    const userId = crypto.randomUUID();
    const result = await db.query(
      `
        INSERT INTO auth_users (
          id,
          username,
          display_name,
          password_hash,
          provider,
          google_sub,
          email,
          avatar_url
        )
        VALUES ($1, $2, $3, '', 'google', $4, $5, $6)
        RETURNING id, username, display_name, provider, email, avatar_url, created_at
      `,
      [userId, username, displayName, payload.sub, email || null, payload.picture || null]
    );

    return res.status(201).json({ user: formatAuthUser(result.rows[0]) });
  } catch (error: any) {
    console.error('[AUTH][GOOGLE]', error?.message || error);
    return res.status(401).json({ error: error?.message || 'Не удалось выполнить вход через Google.' });
  }
}
