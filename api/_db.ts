import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from 'pg';

let pool: Pool | null = null;
let schemaInitPromise: Promise<void> | null = null;

export const setCors = (res: VercelResponse, methods = 'GET, POST, DELETE, OPTIONS') => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export const handleOptions = (req: VercelRequest, res: VercelResponse) => {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
};

export const getDbPool = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }

  return pool;
};

export const requireDb = (res: VercelResponse) => {
  const db = getDbPool();
  if (!db) {
    res.status(500).json({ error: 'База данных не настроена (DATABASE_URL).' });
    return null;
  }
  return db;
};

export const ensureAppSchema = async () => {
  if (schemaInitPromise) {
    return schemaInitPromise;
  }

  schemaInitPromise = (async () => {
    const db = getDbPool();
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

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        settings JSONB NOT NULL DEFAULT '{"agent":true,"confirm":true,"notifs":true}',
        onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        time TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        type TEXT NOT NULL DEFAULT 'regular',
        subtasks JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        preview TEXT NOT NULL DEFAULT '',
        messages JSONB NOT NULL DEFAULT '[]',
        created_at BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  })();

  return schemaInitPromise;
};

export const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const hashPassword = (username: string, password: string) => {
  return crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
};

export const formatAuthUser = (user: any) => ({
  id: String(user.id),
  username: String(user.username),
  displayName: String(user.display_name ?? user.displayName ?? ''),
  createdAt: new Date(user.created_at ?? user.createdAt ?? Date.now()).getTime(),
  provider: user.provider === 'google' ? 'google' : 'local',
  email: user.email ? String(user.email) : undefined,
  avatarUrl: user.avatar_url ? String(user.avatar_url) : undefined,
});
