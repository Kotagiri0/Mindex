import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
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
  } catch (e) {
    console.warn('[DB] vector column/index skipped (pgvector unavailable):', e);
  }
};

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
          SELECT user_id, settings, onboarding_complete, updated_at
          FROM user_profiles
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId]
      ),
      db.query(
        `
          SELECT id, name, time, date, done, type, subtasks
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
          }
        : null,
      tasks: tasksRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        time: row.time || "",
        date: row.date,
        done: row.done,
        type: row.type || "regular",
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
  } catch {
    return res.status(500).json({ error: "Не удалось загрузить данные пользователя." });
  }
});

app.post("/api/data/profile", async (req, res) => {
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

app.post("/api/data/task", async (req, res) => {
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
        String(task.time || ""),
        String(task.date),
        Boolean(task.done),
        String(task.type || "regular"),
        JSON.stringify(task.subtasks || []),
      ]
    );
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Не удалось сохранить задачу." });
  }
});

app.delete("/api/data/task/:id", async (req, res) => {
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

app.post("/api/data/thread", async (req, res) => {
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

app.delete("/api/data/thread/:id", async (req, res) => {
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

app.get("/api/chat", (req, res) => {
  res.json({ status: "ok", message: "Local Chat API is running" });
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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GROQ_API_KEY не найден." });
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

    const groq = new Groq({ apiKey });
    const transcription = await groq.audio.transcriptions.create({
      file: new File([wavBuffer], "audio.wav", { type: "audio/wav" }),
      model: "whisper-large-v3",
      language: "ru",
    });

    console.log('[VOICE] Transcription success:', transcription.text?.slice(0, 100));
    return res.status(200).json({ text: transcription.text });

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
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
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
  const timeoutId = setTimeout(() => controller.abort(), 30000);
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
    if (attempt === 0 && e?.name !== "AbortError") {
      await new Promise(r => setTimeout(r, 600));
      return callRouterAI(apiKey, body, 1);
    }
    throw e;
  }
}

app.post("/api/classify", async (req, res) => {
  const { threadId, userId, messages } = req.body || {};
  if (!threadId || !userId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'threadId, userId, messages required' });
  }
  const apiKey = process.env.ROUTERAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ROUTERAI_API_KEY not set' });

  const dialogText = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map((m: any) => `${m.role === 'user' ? 'Пользователь' : 'Мысль'}: ${String(m.content || '').slice(0, 300)}`)
    .join('\n');

  try {
    const response = await callRouterAI(apiKey, {
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: 'Этот тред требует сохранения как заметка? Ответь только: yes или no.\nyes — если: длинная беседа, план, анализ, цели, инсайты, важные решения, обсуждение идей, 4+ сообщений со смыслом.\nno — если: короткие команды, добавление задач, операционные запросы, менее 4 сообщений.',
        },
        { role: 'user', content: `Тред:\n${dialogText}` },
      ],
      max_tokens: 5,
      temperature: 0,
      thinking: false,
    });

    const data = await response.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
    const isMeaningful = answer.startsWith('yes');

    if (db) {
      await db.query(
        `UPDATE user_threads SET is_meaningful = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [isMeaningful, threadId, userId]
      );

      if (isMeaningful) {
        const threadRes = await db.query(
          `SELECT title, preview FROM user_threads WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [threadId, userId]
        );
        if (threadRes.rows.length > 0) {
          const { title, preview } = threadRes.rows[0];
          const embedding = await generateEmbedding(`${title}\n${preview}`);
          if (embedding) {
            await db.query(
              `UPDATE user_threads SET embedding = $1::vector WHERE id = $2 AND user_id = $3`,
              [`[${embedding.join(',')}]`, threadId, userId]
            );
          }
        }
      }
    }

    return res.status(200).json({ is_meaningful: isMeaningful });
  } catch (err: any) {
    console.error('[classify]', err);
    return res.status(500).json({ error: err.message || 'classify failed' });
  }
});

app.post("/api/summarize", async (req, res) => {
  const { messages, threadId, userId } = req.body || {};
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
          content: `Ты — Мысль, персональный ИИ-ассистент. Структурированно изложи суть диалога в виде заметки.
Формат:
**Суть:** одно предложение — о чём был разговор.
**Ключевые тезисы:** 2–4 буллет-пункта с главными мыслями и решениями.
**Задачи:** (только если были явно упомянуты) краткий список.
Пиши по-русски, кратко, без воды.`,
        },
        { role: 'user', content: `Диалог:\n\n${dialogText}` },
      ],
      max_tokens: 500,
      temperature: 0.3,
      thinking: false,
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: `RouterAI error: ${text}` });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || '';

    if (summary && db && threadId && userId) {
      await db.query(
        `UPDATE user_threads SET summary = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [summary, threadId, userId]
      );

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

    return res.status(200).json({ summary });
  } catch (err: any) {
    console.error('[summarize]', err);
    return res.status(500).json({ error: err.message || 'summarize failed' });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;

    const apiKey = process.env.ROUTERAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ROUTERAI_API_KEY не найден в .env" });
    }

    const response = await callRouterAI(apiKey, {
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemInstruction }, ...messages],
      tools,
      tool_choice: tool_choice || "auto",
      temperature: 0.7,
      max_tokens: 1024,
      thinking: false,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[CHAT] RouterAI error:", response.status, text);
      return res.status(500).json({ error: `RouterAI вернул ошибку ${response.status}: ${text}` });
    }

    const data = await response.json();

    if (!data.choices?.length) {
      throw new Error("RouterAI вернул пустой список вариантов (choices).");
    }

    res.json(data.choices[0].message);
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    const msg = isTimeout
      ? "RouterAI не ответил за 30 секунд — попробуй ещё раз"
      : error.message || "Ошибка сервера";
    console.error("[CHAT] error:", msg);
    res.status(500).json({ error: msg });
  }
});

const startServer = async () => {
  await ensureAuthSchema();

  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", async () => {
        console.log(`Локальный сервер запущен: http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("Ошибка запуска Vite:", err);
    }
    return;
  }

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return;
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Продакшн сервер запущен: http://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Критическая ошибка запуска сервера:", error);
  process.exit(1);
});

export default app;
