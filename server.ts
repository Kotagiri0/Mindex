import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { Pool } from "pg";
import multer from "multer";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { verifyGoogleIdToken } from './src/lib/google-auth.ts';
import { registerBotRoutes, startBot } from './server-bot.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
let vectorEnabled = false;

// Render and similar platforms terminate TLS on the proxy layer.
// trust proxy keeps request metadata correct for HTTPS deployments.
app.set("trust proxy", true);

const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: "mindex" });
collectDefaultMetrics({ register: metricsRegistry });

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

const httpRequestsInFlight = new Gauge({
  name: "http_requests_in_flight",
  help: "Current number of in-flight HTTP requests",
  labelNames: ["method", "route"] as const,
  registers: [metricsRegistry],
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

const dataRateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const key = `${req.ip || "unknown"}:${req.path}`;
  const now = Date.now();
  if (rateLimitBuckets.size > 1000) {
    for (const [bucketKey, bucketValue] of rateLimitBuckets) {
      if (bucketValue.resetAt <= now) {
        rateLimitBuckets.delete(bucketKey);
      }
    }
  }
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Слишком много запросов. Попробуй чуть позже." });
  }

  return next();
};

const getRouteLabel = (req: express.Request) => {
  if (req.route?.path) {
    const routePath = typeof req.route.path === "string" ? req.route.path : req.path;
    return `${req.baseUrl || ""}${routePath}` || req.path;
  }
  return req.path || "unknown_route";
};

app.use(cors());
app.use(express.json());

// Instrument all requests except the Prometheus scrape endpoint itself.
app.use((req, res, next) => {
  if (req.path === "/metrics") {
    return next();
  }

  const method = req.method;
  const routeForGauge = req.path || "unknown_route";
  httpRequestsInFlight.inc({ method, route: routeForGauge });

  const startedAt = process.hrtime.bigint();
  let finished = false;

  const finalize = () => {
    if (finished) {
      return;
    }
    finished = true;

    const statusCode = String(res.statusCode);
    const route = getRouteLabel(req);
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDurationSeconds.observe(
      { method, route, status_code: statusCode },
      durationSeconds
    );
    httpRequestsInFlight.dec({ method, route: routeForGauge });
  };

  res.on("finish", finalize);
  res.on("close", finalize);
  next();
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(await metricsRegistry.metrics());
});

// Logging middleware for API requests
app.use("/api/*", (req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;

// Multer configuration for voice uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const extensionByMimeType: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/webm;codecs=opus": ".webm",
  "audio/ogg": ".ogg",
  "audio/ogg;codecs=opus": ".ogg",
  "audio/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

function resolveAudioExtension(mimeType?: string, originalName?: string): string {
  const fromMime = mimeType ? extensionByMimeType[mimeType.toLowerCase()] : undefined;
  if (fromMime) return fromMime;
  if (originalName) {
    const fromOriginalName = path.extname(originalName).toLowerCase();
    if (fromOriginalName) return fromOriginalName;
  }
  return ".bin";
}

app.get('/api/config', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  return res.status(200).json({
    googleClientId: GOOGLE_CLIENT_ID,
  });
});

const SELF_KNOWLEDGE_TEXT = `Твоё имя — Мысль. Ты — личный ассистент по организации мышления и дел. Не универсальный чат-бот — фокус на личной эффективности: мысли, заметки и задачи в одном месте.

Когда пользователь спрашивает "что ты умеешь", "кто ты", "расскажи о себе", "чем можешь помочь" и подобное — отвечай именно этим, своими словами, не говори "у меня нет доступа к этой информации":

Что умеешь:
— Управлять задачами через разговор — добавить, перенести, изменить, удалить прямо в чате
— Голосовой ввод — пользователь надиктовывает, ты структурируешь
— Brain dump — пользователь выгружает всё подряд, ты разбираешь и структурируешь
— Заметки и архив — прошлые разговоры сохраняются, ты их помнишь и используешь в новых беседах
— Контекст между сессиями — чем дольше пользуешься, тем точнее понимаешь человека

Память: у тебя есть доступ к архиву прошлых разговоров и заметок пользователя. Если в системном блоке "Из архива пользователя" есть данные — ты их видишь и используешь. Если блок пустой — подходящего контекста пока нет.

Чего пока не умеешь: работать с файлами, искать в интернете, интегрироваться с внешними сервисами.

Конфиденциальность: данные пользователя хранятся только у него. Работаешь на мощной современной модели.`;

async function createSelfKnowledgeSkill(userId: string) {
  if (!db) return;
  try {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO user_threads
         (id, user_id, title, preview, messages, created_at, updated_at, source, label, summary, is_meaningful)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, NOW(), 'skill', 'skill:self_knowledge', $6, true)
       ON CONFLICT DO NOTHING`,
      [
        id,
        userId,
        'О Мысли',
        SELF_KNOWLEDGE_TEXT.slice(0, 100),
        Date.now(),
        SELF_KNOWLEDGE_TEXT,
      ]
    );
    const embedding = await generateEmbedding(SELF_KNOWLEDGE_TEXT);
    if (embedding) {
      await db.query(
        `UPDATE user_threads SET embedding = $1::vector WHERE id = $2 AND user_id = $3`,
        [`[${embedding.join(',')}]`, id, userId]
      );
    }
  } catch (e) {
    console.warn('[skill] createSelfKnowledgeSkill failed:', e);
  }
}

const hashPassword = (username: string, password: string) => {
  return crypto
    .createHash("sha256")
    .update(`${username}:${password}`)
    .digest("hex");
};

const formatAuthUser = (user: any) => ({
  id: String(user.id),
  username: String(user.username),
  displayName: String(user.display_name ?? user.displayName ?? ''),
  createdAt: new Date(user.created_at ?? user.createdAt ?? Date.now()).getTime(),
  provider: user.provider === 'google' ? 'google' : 'local',
  email: user.email ? String(user.email) : undefined,
  avatarUrl: user.avatar_url ? String(user.avatar_url) : undefined,
});

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const ensureAuthSchema = async () => {
  if (!db) {
    console.warn("[AUTH] DATABASE_URL is not configured. Auth endpoints will be disabled.");
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

  await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;`);
  await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;`);
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
      calendar_event_id TEXT,
      subtasks JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;`);

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

  // pgvector + second-brain columns
  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  } catch (e) {
    console.warn('[DB] pgvector extension not available:', e);
  }
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS summary TEXT;`);
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS is_meaningful BOOLEAN;`);
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'мысль';`);
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS label TEXT;`);
  try {
    await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS embedding vector(1536);`);
    await db.query(`
      CREATE INDEX IF NOT EXISTS threads_embedding_idx
        ON user_threads USING hnsw (embedding vector_cosine_ops);
    `);
    vectorEnabled = true;
    console.log('[DB] pgvector ready');
  } catch (e) {
    console.warn('[DB] vector column/index skipped (pgvector unavailable):', e);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_link_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
};

// Генерация одноразового кода для привязки Telegram
app.post("/api/telegram/link-code", async (req, res) => {
  if (!db) return res.status(500).json({ error: "БД не настроена." });
  const userId = String(req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId обязателен." });

  const code = `MNDX-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

  await db.query(
    `INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET user_id = $2, expires_at = $3, used = FALSE`,
    [code, userId, expiresAt]
  );

  res.json({ code });
});

// Проверка статуса привязки (polling с фронтенда)
app.get("/api/telegram/link-status", async (req, res) => {
  if (!db) return res.status(500).json({ error: "БД не настроена." });
  const userId = String(req.query.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId обязателен." });

  const { rows } = await db.query(
    `SELECT telegram_chat_id FROM user_profiles WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const linked = Boolean(rows[0]?.telegram_chat_id);
  res.json({ linked });
});

// Тестовый эндпоинт — запускает проактивную отправку немедленно для одного userId
app.post("/api/telegram/proactive-test", async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN не задан" });
  if (!db) return res.status(500).json({ error: "БД не настроена" });

  const userId = String(req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId обязателен" });

  try {
    const apiKey = process.env.ROUTERAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ROUTERAI_API_KEY не задан" });

    const { rows: profileRows } = await db.query(
      `SELECT telegram_chat_id FROM user_profiles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!profileRows[0]?.telegram_chat_id) {
      return res.status(400).json({ error: "Telegram не привязан к этому аккаунту" });
    }
    const chatId = profileRows[0].telegram_chat_id;
    const today = new Date().toISOString().split('T')[0];

    const [tasksRes, threadsRes] = await Promise.all([
      db.query(
        `SELECT name, date, time FROM user_tasks WHERE user_id = $1 AND done = false ORDER BY date ASC, time ASC NULLS LAST LIMIT 5`,
        [userId]
      ),
      db.query(
        `SELECT title, summary FROM user_threads WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful = true ORDER BY updated_at DESC LIMIT 3`,
        [userId]
      ),
    ]);

    if (tasksRes.rows.length === 0 && threadsRes.rows.length === 0) {
      return res.json({ sent: false, reason: "Нет контекста для отправки" });
    }

    const taskLines = tasksRes.rows.map((t: any) => {
      const when = t.date === today ? 'сегодня' : t.date;
      return `- ${t.name} (${when}${t.time ? ', ' + t.time : ''})`;
    }).join('\n');

    const threadLines = threadsRes.rows.map((t: any) =>
      `[${t.title}]: ${t.summary?.slice(0, 120)}`
    ).join('\n');

    const userContext = [
      taskLines ? `Незакрытые задачи:\n${taskLines}` : '',
      threadLines ? `Из прошлых разговоров:\n${threadLines}` : '',
    ].filter(Boolean).join('\n\n');

    const prompt = `Ты — Мысль, персональный AI-ассистент. Сгенерируй одно короткое проактивное сообщение пользователю.\n\nКонтекст пользователя:\n${userContext}\n\nПравила:\n- Максимум 2 предложения\n- Конкретная отсылка к реальному контексту\n- Заканчивается вопросом или мягким действием\n- Никогда: "Как дела?", "Чем могу помочь?"\n- Одна самая важная задача, не список\n- Звучи как живой собеседник\n- Plaintext, без кавычек, без подписи`;

    const aiRes = await fetch('https://routerai.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.8, thinking: false }),
    });

    const aiData = await aiRes.json();
    const text = aiData.choices?.[0]?.message?.content?.trim();
    if (!text) return res.status(500).json({ error: "AI не вернул текст" });

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    res.json({ sent: true, text });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const username = normalizeUsername(String(req.body?.username || ""));
  const password = String(req.body?.password || "");
  const rawDisplayName = String(req.body?.displayName || "").trim();
  const displayName = rawDisplayName || username;

  if (!username || !password) {
    return res.status(400).json({ error: "Укажи имя пользователя и пароль." });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: "Имя пользователя должно быть не короче 3 символов." });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: "Пароль должен быть не короче 4 символов." });
  }

  try {
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(username, password);

    const result = await db.query(
      `
        INSERT INTO auth_users (id, username, display_name, password_hash, provider)
        VALUES ($1, $2, $3, $4, 'local')
        RETURNING id, username, display_name, created_at, provider, email, avatar_url
      `,
      [userId, username, displayName, passwordHash]
    );

    createSelfKnowledgeSkill(userId);
    return res.status(201).json({
      user: formatAuthUser(result.rows[0]),
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "Такой пользователь уже существует." });
    }
    return res.status(500).json({ error: "Не удалось зарегистрировать пользователя." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const username = normalizeUsername(String(req.body?.username || ""));
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Укажи имя пользователя и пароль." });
  }

  try {
    const result = await db.query(
      `
        SELECT id, username, display_name, password_hash, provider, email, avatar_url, created_at
        FROM auth_users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден." });
    }

    const user = result.rows[0];
    const passwordHash = hashPassword(username, password);

    if (passwordHash !== user.password_hash) {
      return res.status(401).json({ error: "Неверный пароль." });
    }

    return res.status(200).json({
      user: formatAuthUser(user),
    });
  } catch {
    return res.status(500).json({ error: "Не удалось выполнить вход." });
  }
});

app.post('/api/auth/google', async (req, res) => {
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

    createSelfKnowledgeSkill(userId);
    return res.status(201).json({ user: formatAuthUser(result.rows[0]) });
  } catch (error: any) {
    console.error('[AUTH][GOOGLE]', error?.message || error);
    return res.status(401).json({ error: error?.message || 'Не удалось выполнить вход через Google.' });
  }
});

app.get("/api/data/bootstrap", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  try {
    const [profileRes, tasksRes, threadsRes] = await Promise.all([
      db.query(
        `
          SELECT user_id, settings, onboarding_complete, updated_at, telegram_chat_id
          FROM user_profiles
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId]
      ),
      db.query(
        `
          SELECT id, name, time, date, done, type, calendar_event_id, subtasks
          FROM user_tasks
          WHERE user_id = $1
          ORDER BY updated_at DESC, created_at DESC
        `,
        [userId]
      ),
      db.query(
        `
          SELECT id, title, preview, messages, created_at, summary, is_meaningful, source, label
          FROM user_threads
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId]
      ),
    ]);

    const profileRow = profileRes.rows[0] || null;

    return res.status(200).json({
      profile: profileRow
        ? {
            settings: profileRow.settings,
            onboarding_complete: profileRow.onboarding_complete,
            updated_at: profileRow.updated_at,
            telegram_chat_id: profileRow.telegram_chat_id || null,
          }
        : null,
      tasks: tasksRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        time: row.time || "",
        date: row.date,
        done: row.done,
        type: row.type || "regular",
        calendarEventId: row.calendar_event_id || undefined,
        subtasks: row.subtasks || [],
      })),
      threads: threadsRes.rows.map((row) => ({
        id: row.id,
        title: row.title,
        preview: row.preview,
        messages: row.messages || [],
        createdAt: Number(row.created_at),
        summary: row.summary || undefined,
        is_meaningful: row.is_meaningful ?? undefined,
        source: row.source || 'мысль',
        label: row.label || undefined,
      })),
    });
  } catch (err) {
    console.error('[API] bootstrap error:', err);
    return res.status(500).json({ error: "Не удалось загрузить данные пользователя." });
  }
});

app.post("/api/data/profile", dataRateLimit, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.body?.userId || "").trim();
  const settings = req.body?.settings || { agent: true, confirm: true, notifs: true };
  const onboardingComplete = Boolean(req.body?.onboarding_complete);

  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  try {
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
      [userId, JSON.stringify(settings), onboardingComplete]
    );

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось сохранить профиль." });
  }
});

app.post("/api/data/task", dataRateLimit, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const task = req.body?.task;
  const userId = String(req.body?.userId || "").trim();
  if (!userId || !task?.id || !task?.name || !task?.date) {
    return res.status(400).json({ error: "Некорректные данные задачи." });
  }

  try {
      await db.query(
        `
        INSERT INTO user_tasks (id, user_id, name, time, date, done, type, calendar_event_id, subtasks, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          time = EXCLUDED.time,
          date = EXCLUDED.date,
          done = EXCLUDED.done,
          type = EXCLUDED.type,
          calendar_event_id = EXCLUDED.calendar_event_id,
          subtasks = EXCLUDED.subtasks,
          updated_at = NOW()
      `,
      [
        String(task.id),
        userId,
        String(task.name),
        String(task.time || ""),
        String(task.date),
        Boolean(task.done),
        String(task.type || "regular"),
        task.calendarEventId ? String(task.calendarEventId) : null,
        JSON.stringify(task.subtasks || []),
      ]
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[API] POST /api/data/task error:', err);
    return res.status(500).json({ error: "Не удалось сохранить задачу." });
  }
});

app.delete("/api/data/task/:id", dataRateLimit, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const id = String(req.params.id || "").trim();
  const userId = String(req.query.userId || "").trim();
  if (!id || !userId) {
    return res.status(400).json({ error: "id и userId обязательны." });
  }

  try {
    await db.query(`DELETE FROM user_tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось удалить задачу." });
  }
});

app.post("/api/data/thread", dataRateLimit, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const thread = req.body?.thread;
  const userId = String(req.body?.userId || "").trim();
  if (!userId || !thread?.id) {
    return res.status(400).json({ error: "Некорректные данные треда." });
  }

  try {
    await db.query(
      `
        INSERT INTO user_threads (id, user_id, title, preview, messages, created_at, updated_at, source, label, summary, is_meaningful)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), $7, $8, $9, $10)
        ON CONFLICT (id)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          title = EXCLUDED.title,
          preview = EXCLUDED.preview,
          messages = EXCLUDED.messages,
          created_at = EXCLUDED.created_at,
          source = COALESCE(EXCLUDED.source, user_threads.source),
          label = COALESCE(EXCLUDED.label, user_threads.label),
          summary = COALESCE(EXCLUDED.summary, user_threads.summary),
          is_meaningful = COALESCE(EXCLUDED.is_meaningful, user_threads.is_meaningful),
          updated_at = NOW()
      `,
      [
        String(thread.id),
        userId,
        String(thread.title || "Новая мысль"),
        String(thread.preview || ""),
        JSON.stringify(thread.messages || []),
        Number(thread.createdAt || Date.now()),
        String(thread.source || 'мысль'),
        thread.label ? String(thread.label) : null,
        thread.summary ? String(thread.summary) : null,
        thread.is_meaningful ?? null,
      ]
    );
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось сохранить тред." });
  }
});

app.delete("/api/data/thread/:id", dataRateLimit, async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const id = String(req.params.id || "").trim();
  const userId = String(req.query.userId || "").trim();
  if (!id || !userId) {
    return res.status(400).json({ error: "id и userId обязательны." });
  }

  try {
    await db.query(`DELETE FROM user_threads WHERE id = $1 AND user_id = $2`, [id, userId]);
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось удалить тред." });
  }
});

app.patch("/api/data/thread/:id/archive", async (req, res) => {
  if (!db) return res.status(500).json({ error: "База данных не настроена." });

  const id = String(req.params.id || "").trim();
  const { userId } = req.body || {};
  if (!id || !userId) return res.status(400).json({ error: "id и userId обязательны." });

  try {
    const result = await db.query(
      `UPDATE user_threads SET source = 'заметка', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, String(userId)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Тред не найден." });
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[archive]', err);
    return res.status(500).json({ error: "Не удалось архивировать тред." });
  }
});

app.get("/api/chat", (req, res) => {
  res.json({ status: "ok", message: "Local Chat API is running" });
});

app.post("/api/admin/backfill-embeddings", async (req, res) => {
  if (!db) return res.status(500).json({ error: "БД не настроена." });
  const secret = String(req.body?.secret || "").trim();
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden." });

  try {
    const { rows } = await db.query(
      `SELECT id, title, summary, preview FROM user_threads WHERE embedding IS NULL AND source != 'skill' LIMIT 200`
    );

    let done = 0;
    for (const row of rows) {
      const text = [row.title, row.summary, row.preview].filter(Boolean).join(' ');
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await db.query(
          `UPDATE user_threads SET embedding = $1::vector WHERE id = $2`,
          [`[${embedding.join(',')}]`, row.id]
        );
        done++;
      }
      await new Promise(r => setTimeout(r, 50));
    }

    return res.json({ total: rows.length, done });
  } catch (err: any) {
    console.error('[BACKFILL] error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/search", async (req, res) => {
  if (!db) return res.status(500).json({ error: "БД не настроена." });
  const userId = String(req.query.userId || "").trim();
  const query = String(req.query.q || "").trim();
  if (!userId || !query) return res.status(400).json({ error: "userId и q обязательны." });

  try {
    const embedding = await generateEmbedding(query);

    if (embedding && vectorEnabled) {
      const { rows } = await db.query(
        `SELECT id, title, preview, source, updated_at, summary, is_meaningful, label,
                1 - (embedding <=> $1::vector) as score
         FROM user_threads
         WHERE user_id = $2 AND source != 'skill' AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 20`,
        [`[${embedding.join(',')}]`, userId]
      );
      return res.json({ results: rows, mode: 'semantic' });
    }

    // Fallback: keyword search
    const { rows } = await db.query(
      `SELECT id, title, preview, source, updated_at, summary, is_meaningful, label
       FROM user_threads
       WHERE user_id = $1 AND source != 'skill'
         AND (title ILIKE $2 OR preview ILIKE $2 OR summary ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT 20`,
      [userId, `%${query}%`]
    );
    return res.json({ results: rows, mode: 'keyword' });
  } catch (err: any) {
    console.error('[SEARCH] error:', err);
    return res.status(500).json({ error: 'Ошибка поиска.' });
  }
});

app.post("/api/voice/transcribe", upload.single('audio'), async (req, res) => {
  let tmpIn = "";
  let tmpOut = "";

  try {
    console.log('[VOICE] file mimetype:', req.file?.mimetype);
    console.log('[VOICE] file size:', req.file?.size);

    if (!req.file) {
      return res.status(400).json({ error: "Аудиофайл не загружен." });
    }
    if (req.file.size === 0) {
      return res.status(400).json({ error: "Аудиофайл пуст (0 байт)." });
    }

    const apiKey = process.env.VSEGPT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "VSEGPT_API_KEY не найден." });
    }

    const inputExtension = resolveAudioExtension(req.file.mimetype, req.file.originalname);
    tmpIn = path.join(os.tmpdir(), `voice_in_${Date.now()}${inputExtension}`);
    tmpOut = path.join(os.tmpdir(), `voice_out_${Date.now()}.wav`);

    fs.writeFileSync(tmpIn, req.file.buffer);

    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', tmpIn, '-vn', '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', '-f', 'wav', tmpOut]);
      let stderr = '';
      ff.stderr.on('data', (d) => { stderr += d.toString(); });
      ff.on('close', (code) => {
        if (code !== 0) {
          console.error('[VOICE] ffmpeg stderr:', stderr);
          reject(new Error(`ffmpeg failed: ${stderr.slice(-200)}`));
        } else resolve();
      });
      ff.on('error', (e) => reject(new Error(`ffmpeg not found: ${e.message}`)));
    });

    const wavBuffer = fs.readFileSync(tmpOut);
    console.log('[VOICE] Converted to wav:', wavBuffer.length, 'bytes');

    const formData = new FormData();
    formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'stt-openai/whisper-v3-turbo');
    formData.append('language', 'ru');

    const aiRes = await fetch('https://api.vsegpt.ru/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('[VOICE] VseGPT error:', err);
      return res.status(500).json({ error: 'Ошибка транскрибации.' });
    }

    const aiData = await aiRes.json() as any;
    const text = (aiData.text ?? '').trim();

    console.log('[VOICE] Transcription success:', text.slice(0, 100));
    return res.status(200).json({ text });

  } catch (error: any) {
    console.error("[VOICE] Transcription error:", error?.message || error);
    res.status(500).json({ error: error?.message || "Не удалось транскрибировать аудио." });
  } finally {
    if (tmpIn && fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (tmpOut && fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
});

async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey || !text?.trim()) return null;
  try {
    const response = await fetch('https://routerai.ru/api/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text.slice(0, 8000) }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

async function callRouterAI(apiKey: string, body: object, attempt = 0): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch("https://routerai.ru/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    clearTimeout(timeoutId);
    return response;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (attempt < 2) {
      const delay = e?.name === "AbortError" ? 1000 : 600;
      console.warn(`[CHAT] RouterAI attempt ${attempt + 1} failed (${e?.name}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return callRouterAI(apiKey, body, attempt + 1);
    }
    throw e;
  }
}

app.post("/api/summarize", async (req, res) => {
  const { messages, threadId, userId, raw, rawSummary } = req.body || {};
  // raw=true: заметка создана вручную — не нужен LLM, только DB write
  if (raw && rawSummary) {
    try {
      if (db && threadId && userId) {
        await db.query(
          `UPDATE user_threads SET summary = $1, is_meaningful = true, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
          [String(rawSummary), threadId, userId]
        );
        // Embedding — fire-and-forget, не блокируем ответ если pgvector недоступен
        const threadRes = await db.query(
          `SELECT title FROM user_threads WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [threadId, userId]
        );
        const title = threadRes.rows?.[0]?.title || '';
        generateEmbedding(`${title}\n${rawSummary}`).then(embedding => {
          if (embedding && db) {
            db.query(
              `UPDATE user_threads SET embedding = $1::vector WHERE id = $2 AND user_id = $3`,
              [`[${embedding.join(',')}]`, threadId, userId]
            ).catch(e => console.warn('[summarize/raw embed]', e.message));
          }
        }).catch(() => {});
      }
      return res.status(200).json({ summary: rawSummary });
    } catch (err: any) {
      console.error('[summarize/raw]', err);
      return res.status(500).json({ error: err.message || 'embed failed' });
    }
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ROUTERAI_API_KEY not set' });

  const dialogText = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => `${m.role === 'user' ? 'Пользователь' : 'Мысль'}: ${String(m.content || '')}`)
    .join('\n');

  try {
    const response = await callRouterAI(apiKey, {
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: `Ты — Мысль, персональный ИИ-ассистент. Проанализируй диалог и верни JSON-объект:
{
  "is_meaningful": true/false,
  "summary": "..."
}

is_meaningful = true если диалог содержит: цели, планы, задачи, решения, важные мысли, информацию о пользователе, его проектах или приоритетах.
is_meaningful = false если диалог: короткий small-talk, технические тесты, приветствия, бессодержательные реплики.

Если is_meaningful = true, summary — структурированная заметка:
**Суть:** одно предложение — о чём был разговор.
**Ключевые тезисы:** 2–4 буллет-пункта с главными мыслями и решениями.
**Задачи:** (только если были явно упомянуты) краткий список.

Если is_meaningful = false, summary = "".
Пиши по-русски. Верни только валидный JSON, без markdown-обёртки.`,
        },
        { role: 'user', content: `Диалог:\n\n${dialogText}` },
      ],
      max_tokens: 600,
      temperature: 0.2,
      thinking: false,
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: `RouterAI error: ${text}` });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    let summary = '';
    let isMeaningful = false;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
      isMeaningful = Boolean(parsed.is_meaningful);
      summary = isMeaningful ? (parsed.summary || '') : '';
    } catch {
      // Если модель не вернула JSON — считаем контент саммари, is_meaningful = true
      summary = rawContent;
      isMeaningful = rawContent.length > 20;
    }

    if (db && threadId && userId) {
      await db.query(
        `UPDATE user_threads SET summary = $1, is_meaningful = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4`,
        [summary || null, isMeaningful, threadId, userId]
      );

      if (isMeaningful && summary) {
        const threadRes = await db.query(
          `SELECT title FROM user_threads WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [threadId, userId]
        );
        const title = threadRes.rows?.[0]?.title || '';
        const embedding = await generateEmbedding(`${title}\n${summary}`);
        if (embedding) {
          await db.query(
            `UPDATE user_threads SET embedding = $1::vector WHERE id = $2 AND user_id = $3`,
            [`[${embedding.join(',')}]`, threadId, userId]
          );
        }
      }
    }

    return res.status(200).json({ summary, is_meaningful: isMeaningful });
  } catch (err: any) {
    console.error('[summarize]', err);
    return res.status(500).json({ error: err.message || 'summarize failed' });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemInstruction, tools, tool_choice, userId } = req.body;

    const apiKey = process.env.ROUTERAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ROUTERAI_API_KEY не найден в .env" });
    }

    // Обновляем время активности пользователя
    if (db && userId) {
      db.query(
        `UPDATE user_profiles SET last_active_at = NOW() WHERE user_id = $1`,
        [userId]
      ).catch(() => {});
    }

    // Build system prompt: base → personal profile → rag context
    let finalSystemInstruction = `${systemInstruction}\n\n## О себе\n${SELF_KNOWLEDGE_TEXT}`;
    let ragSources: { title: string }[] = [];

    // Always inject personal user profile — onboarding note + any self-description notes
    // This is NOT RAG (no keyword matching) — always present so model knows who it's talking to
    if (db && userId) {
      try {
        const profileRes = await db.query(
          `SELECT title, summary FROM user_threads
           WHERE user_id = $1
             AND summary IS NOT NULL
             AND is_meaningful IS NOT FALSE
             AND (
               title = 'О себе'
               OR label = 'profile'
               OR (source = 'заметка' AND title ILIKE '%себ%')
             )
           ORDER BY created_at ASC
           LIMIT 3`,
          [userId]
        );
        if (profileRes.rows.length > 0) {
          const profileText = profileRes.rows.map((r: any) => r.summary).join('\n\n');
          finalSystemInstruction += `\n\n## Что пользователь рассказал о себе\n${profileText}`;
        }
      } catch (e) {
        console.warn('[CHAT] profile inject failed:', e);
      }
    }

    // Ensure DB skill thread exists for vector search (fire-and-forget for new users)
    if (db && userId) {
      db.query(
        `SELECT 1 FROM user_threads WHERE user_id = $1 AND label = 'skill:self_knowledge' LIMIT 1`,
        [userId]
      ).then((r: any) => {
        if (r.rows.length === 0) createSelfKnowledgeSkill(userId).catch(() => {});
      }).catch(() => {});
    }

    if (!db) console.warn('[RAG] db=null, skipping — DATABASE_URL not set?');
    if (!userId) console.warn('[RAG] userId=null, skipping — client did not send userId');

    if (db && userId) {

      if (Array.isArray(messages) && messages.length > 0) {
        try {
          const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
          if (lastUserMsg?.content) {
            let ragResult: any = { rows: [] };
            let isExplicitMatch = false; // true только при реальном совпадении, не fallback

            const keywords = String(lastUserMsg.content)
              .toLowerCase()
              .replace(/[^\wа-яё\s]/gi, '')
              .split(/\s+/)
              .filter(w => w.length > 3)
              .slice(0, 5);

            if (vectorEnabled) {
              const queryEmbedding = await generateEmbedding(String(lastUserMsg.content));
              if (queryEmbedding) {
                ragResult = await db.query(
                  `SELECT title, summary
                   FROM user_threads
                   WHERE user_id = $1
                     AND summary IS NOT NULL
                     AND embedding IS NOT NULL
                     AND is_meaningful IS NOT FALSE
                     AND label IS DISTINCT FROM 'skill:self_knowledge'
                     AND title IS DISTINCT FROM 'О себе'
                     AND 1 - (embedding <=> $2::vector) > 0.65
                   ORDER BY embedding <=> $2::vector
                   LIMIT 3`,
                  [userId, `[${queryEmbedding.join(',')}]`]
                );
                if (ragResult.rows.length > 0) isExplicitMatch = true;
              }
              if (ragResult.rows.length === 0 && keywords.length > 0) {
                const conditions = keywords.map((_: string, i: number) => `(title ILIKE $${i + 2} OR summary ILIKE $${i + 2})`).join(' OR ');
                ragResult = await db.query(
                  `SELECT title, summary FROM user_threads
                   WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful IS NOT FALSE AND label IS DISTINCT FROM 'skill:self_knowledge'
                     AND title IS DISTINCT FROM 'О себе'
                     AND (${conditions})
                   ORDER BY updated_at DESC LIMIT 3`,
                  [userId, ...keywords.map((k: string) => `%${k}%`)]
                );
                if (ragResult.rows.length > 0) isExplicitMatch = true;
              }
              if (ragResult.rows.length === 0) {
                ragResult = await db.query(
                  `SELECT title, summary FROM user_threads
                   WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful IS NOT FALSE
                     AND label IS DISTINCT FROM 'skill:self_knowledge'
                     AND title IS DISTINCT FROM 'О себе'
                   ORDER BY updated_at DESC LIMIT 3`,
                  [userId]
                );
              }
            } else {
              // Text-based: keyword matching on summary/title
              if (keywords.length > 0) {
                const conditions = keywords.map((_: string, i: number) => `(title ILIKE $${i + 2} OR summary ILIKE $${i + 2})`).join(' OR ');
                ragResult = await db.query(
                  `SELECT title, summary FROM user_threads
                   WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful IS NOT FALSE AND label IS DISTINCT FROM 'skill:self_knowledge'
                     AND title IS DISTINCT FROM 'О себе'
                     AND (${conditions})
                   ORDER BY updated_at DESC LIMIT 3`,
                  [userId, ...keywords.map((k: string) => `%${k}%`)]
                );
                if (ragResult.rows.length > 0) isExplicitMatch = true;
              }

              // Fallback: recent threads for context only, no sources shown
              if (ragResult.rows.length === 0) {
                ragResult = await db.query(
                  `SELECT title, summary FROM user_threads
                   WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful IS NOT FALSE
                     AND label IS DISTINCT FROM 'skill:self_knowledge'
                     AND title IS DISTINCT FROM 'О себе'
                   ORDER BY updated_at DESC LIMIT 3`,
                  [userId]
                );
              }
            }

            if (ragResult.rows.length > 0) {
              const contextBlock = ragResult.rows
                .map((r: any) => `[${r.title}]\n${r.summary}`)
                .join('\n---\n');
              const ragBlock = `## Из архива пользователя\nНиже — фрагменты из заметок и прошлых разговоров пользователя. Используй их как контекст при ответе. Не упоминай сам факт наличия архива, если пользователь не спрашивает.\n\n${contextBlock}`;
              finalSystemInstruction = `${finalSystemInstruction}\n\n${ragBlock}`;
              // Источники показываем только при явном совпадении
              if (isExplicitMatch) {
                ragSources = ragResult.rows.map((r: any) => ({ title: r.title }));
              }
              console.log('[RAG] injected:', ragResult.rows.map((r: any) => r.title), isExplicitMatch ? '(explicit)' : '(fallback, no sources)');
            } else {
              console.log('[RAG] no matching context found for userId:', userId);
            }
          }
        } catch (ragErr) {
          console.warn('[CHAT] RAG skipped:', ragErr);
        }
      }
    }

    const response = await callRouterAI(apiKey, {
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: finalSystemInstruction }, ...messages],
      tools,
      tool_choice: tool_choice || "auto",
      temperature: 0.7,
      max_tokens: 2048,
      thinking: false,
      stream: true,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[CHAT] RouterAI error:", response.status, text);
      return res.status(500).json({ error: `RouterAI вернул ошибку ${response.status}: ${text}` });
    }

    // SSE streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCallsAcc: any[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullContent += delta.content;
              res.write(`data: ${JSON.stringify({ type: 'delta', content: delta.content })}\n\n`);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
                if (tc.id) toolCallsAcc[idx].id = tc.id;
                if (tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Send final message with tool_calls and sources
    const finalMessage: any = { role: 'assistant', content: fullContent, sources: ragSources };
    if (toolCallsAcc.length > 0) finalMessage.tool_calls = toolCallsAcc;
    res.write(`data: ${JSON.stringify({ type: 'done', message: finalMessage })}\n\n`);
    res.end();

  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    const msg = isTimeout
      ? "RouterAI не ответил за 30 секунд — попробуй ещё раз"
      : error.message || "Ошибка сервера";
    console.error("[CHAT] error:", msg);
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
      res.end();
    }
  }
});

async function sendProactiveMessages(token: string): Promise<void> {
  if (!db) return;
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return;

  try {
    const today = new Date().toISOString().split('T')[0];

    // Берём пользователей с Telegram, которые не были активны сегодня
    const { rows: users } = await db.query(
      `SELECT p.user_id, p.telegram_chat_id
       FROM user_profiles p
       WHERE p.telegram_chat_id IS NOT NULL
         AND (p.last_active_at IS NULL OR p.last_active_at::date < $1::date)`,
      [today]
    );

    for (const user of users) {
      try {
        // Собираем контекст: незакрытые задачи + последние summary из тредов
        const [tasksRes, threadsRes] = await Promise.all([
          db.query(
            `SELECT name, date, time FROM user_tasks
             WHERE user_id = $1 AND done = false
             ORDER BY date ASC, time ASC NULLS LAST
             LIMIT 5`,
            [user.user_id]
          ),
          db.query(
            `SELECT title, summary FROM user_threads
             WHERE user_id = $1 AND summary IS NOT NULL AND is_meaningful = true
             ORDER BY updated_at DESC
             LIMIT 3`,
            [user.user_id]
          ),
        ]);

        // Если нет никакого контекста — молчим
        if (tasksRes.rows.length === 0 && threadsRes.rows.length === 0) continue;

        const taskLines = tasksRes.rows.map((t: any) => {
          const when = t.date === today ? 'сегодня' : t.date;
          return `- ${t.name} (${when}${t.time ? ', ' + t.time : ''})`;
        }).join('\n');

        const threadLines = threadsRes.rows.map((t: any) =>
          `[${t.title}]: ${t.summary?.slice(0, 120)}`
        ).join('\n');

        const userContext = [
          taskLines ? `Незакрытые задачи:\n${taskLines}` : '',
          threadLines ? `Из прошлых разговоров:\n${threadLines}` : '',
        ].filter(Boolean).join('\n\n');

        const prompt = `Ты — Мысль, персональный AI-ассистент. Сгенерируй одно короткое проактивное сообщение пользователю.

Контекст пользователя:
${userContext}

Правила:
- Максимум 2 предложения
- Конкретная отсылка к реальному контексту — не общие фразы
- Заканчивается либо вопросом, либо мягким действием
- Никогда: "Как дела?", "Чем могу помочь?", "Доброе утро!" без контекста
- Выбери одну самую важную или просроченную задачу — не перечисляй всё
- Звучи как живой собеседник, не как бот
- Не упоминай что это автоматическое сообщение
- Plaintext, без кавычек, без подписи`;

        const response = await fetch('https://routerai.ru/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'deepseek/deepseek-v4-flash',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0.8,
            thinking: false,
          }),
        });

        if (!response.ok) continue;
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text || text.length < 10) continue;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: user.telegram_chat_id, text }),
        });

        console.log(`[Proactive] Отправлено пользователю ${user.user_id}`);
      } catch (e: any) {
        console.error(`[Proactive] Ошибка для ${user.user_id}:`, e?.message);
      }
    }
  } catch (e: any) {
    console.error('[Proactive] Ошибка планировщика:', e?.message);
  }
}

function startProactiveScheduler(token: string): void {
  const HOUR = 9; // 9:00 утра по серверному времени

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      sendProactiveMessages(token).catch(e => console.error('[Proactive]', e));
      setInterval(() => sendProactiveMessages(token).catch(e => console.error('[Proactive]', e)), 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Proactive] Следующая отправка в ${next.toISOString()}`);
  };

  scheduleNext();
}

async function startNotificationScheduler(token: string): Promise<void> {
  const REMIND_BEFORE_MIN = 15;

  const tick = async () => {
    if (!db) return;
    try {
      const now = new Date();
      const targetTime = new Date(now.getTime() + REMIND_BEFORE_MIN * 60 * 1000);
      const todayStr = now.toISOString().split('T')[0];
      const hh = String(targetTime.getHours()).padStart(2, '0');
      const mm = String(targetTime.getMinutes()).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;

      const { rows } = await db.query(
        `SELECT t.id, t.name, t.user_id, p.telegram_chat_id
         FROM user_tasks t
         JOIN user_profiles p ON p.user_id = t.user_id
         WHERE t.date = $1
           AND t.time = $2
           AND t.done = false
           AND p.telegram_chat_id IS NOT NULL
           AND (t.notified_at IS NULL OR t.notified_at < NOW() - INTERVAL '23 hours')`,
        [todayStr, timeStr]
      );

      for (const row of rows) {
        try {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: row.telegram_chat_id, text: `⏰ Через ${REMIND_BEFORE_MIN} минут: ${row.name}` }),
          });
          await db.query(
            `UPDATE user_tasks SET notified_at = NOW() WHERE id = $1`,
            [row.id]
          );
        } catch (e: any) {
          console.error('[Notif] Ошибка отправки:', e?.message);
        }
      }
    } catch (e: any) {
      console.error('[Notif] Ошибка планировщика:', e?.message);
    }
  };

  setInterval(tick, 60_000);
  console.log('[Notif] Планировщик уведомлений запущен (интервал 1 мин)');
}

const startServer = async () => {
  await ensureAuthSchema();
  // Добавляем колонку notified_at если её нет
  if (db) {
    await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;`).catch(() => {});
  }

  // Регистрируем маршруты Telegram-бота
  if (db) {
    registerBotRoutes(app, db);
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Локальный сервер запущен: http://localhost:${PORT}`);
        if (db) startBot(db).catch(e => console.error('[Bot] startBot error:', e));
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          startNotificationScheduler(botToken);
          startProactiveScheduler(botToken);
        }
      });
    } catch (err) {
      console.error("Ошибка запуска Vite:", err);
    }
    return;
  }

  const distPath = path.join(process.cwd(), "dist");
  app.get("/", (_req, res) => {
    res.sendFile(path.join(distPath, "landing.html"));
  });
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return;
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Продакшн сервер запущен: http://localhost:${PORT}`);
    if (db) startBot(db).catch(e => console.error('[Bot] startBot error:', e));
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      startNotificationScheduler(botToken);
      startProactiveScheduler(botToken);
    }
  });
};

startServer().catch((error) => {
  console.error("Критическая ошибка запуска сервера:", error);
  process.exit(1);
});

export default app;
