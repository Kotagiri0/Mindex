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
import * as googleCalendar from './server/google-calendar.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const resolveBaseUrl = (req: express.Request) => {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader || req.protocol;
  const hostHeader = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${hostHeader}`;
};

const resolveCalendarWebhookUrl = (req: express.Request) =>
  process.env.GOOGLE_CALENDAR_WEBHOOK_URL || `${resolveBaseUrl(req)}/api/integrations/google-calendar/webhook`;

const resolveOAuthRedirectUrl = (req: express.Request) =>
  process.env.GOOGLE_OAUTH_REDIRECT_URL || `${resolveBaseUrl(req)}/api/integrations/google-calendar/oauth/callback`;

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

  await googleCalendar.ensureGoogleCalendarSchema(db);
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

app.get("/api/integrations/google-calendar/status", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  try {
    const status = await googleCalendar.getCalendarStatus(db, userId);
    return res.status(200).json(status);
  } catch (error: any) {
    console.error("[GCAL][STATUS]", error?.message || error);
    return res.status(500).json({ error: "Не удалось получить статус Google Calendar." });
  }
});

app.get("/api/integrations/google-calendar/oauth/start", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены." });
  }

  try {
    const state = await googleCalendar.createOAuthState(db, userId);
    const redirectUri = resolveOAuthRedirectUrl(req);
    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: googleCalendar.GOOGLE_CALENDAR_SCOPE,
      state,
      include_granted_scopes: "true",
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return res.status(200).json({ url });
  } catch (error: any) {
    console.error("[GCAL][OAUTH_START]", error?.message || error);
    return res.status(500).json({ error: "Не удалось начать подключение Google Calendar." });
  }
});

app.get("/api/integrations/google-calendar/oauth/callback", async (req, res) => {
  if (!db) {
    return res.status(500).send("DATABASE_URL не настроен.");
  }

  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  if (!code || !state) {
    return res.status(400).send("Некорректный ответ OAuth.");
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).send("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены.");
  }

  try {
    const userId = await googleCalendar.consumeOAuthState(db, state);
    if (!userId) {
      return res.status(400).send("OAuth-сессия истекла. Попробуй подключить заново.");
    }

    const redirectUri = resolveOAuthRedirectUrl(req);
    const tokens = await googleCalendar.exchangeCodeForTokens({
      code,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri,
    });
    await googleCalendar.upsertTokens(db, userId, tokens);

    const html = `
      <!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Google Calendar подключен</title>
          <style>
            body { font-family: Arial, sans-serif; background: #f7f7f7; margin: 0; padding: 32px; color: #222; }
            .card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
            .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
            .desc { font-size: 14px; line-height: 1.5; color: #555; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="title">Google Calendar подключен</div>
            <div class="desc">Можно закрыть это окно и вернуться в Mindex.</div>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: "google_calendar_connected" }, "*");
              window.close();
            }
          </script>
        </body>
      </html>
    `;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error: any) {
    console.error("[GCAL][OAUTH_CALLBACK]", error?.message || error);
    return res.status(500).send("Не удалось подключить Google Calendar.");
  }
});

app.get("/api/integrations/google-calendar/calendars", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены." });
  }

  try {
    const tokens = await googleCalendar.getValidAccessToken(db, userId, googleClientId, googleClientSecret);
    const calendars = await googleCalendar.listCalendars(tokens.access_token);
    return res.status(200).json({ calendars, selectedId: tokens.calendar_id || null });
  } catch (error: any) {
    console.error("[GCAL][CALENDARS]", error?.message || error);
    return res.status(500).json({ error: "Не удалось загрузить календари." });
  }
});

app.post("/api/integrations/google-calendar/select", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.body?.userId || "").trim();
  const calendarId = String(req.body?.calendarId || "").trim();
  if (!userId || !calendarId) {
    return res.status(400).json({ error: "userId и calendarId обязательны." });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены." });
  }

  try {
    const tokens = await googleCalendar.getValidAccessToken(db, userId, googleClientId, googleClientSecret);
    const calendars = await googleCalendar.listCalendars(tokens.access_token);
    const selected = calendars.find((item: any) => item.id === calendarId);
    if (!selected) {
      return res.status(404).json({ error: "Календарь не найден." });
    }

    await googleCalendar.updateSelectedCalendar(db, userId, {
      id: selected.id,
      name: selected.name,
      timeZone: selected.timeZone,
    });

    const sync = await googleCalendar.syncCalendarEvents({
      db,
      userId,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      webhookUrl: resolveCalendarWebhookUrl(req),
      forceFull: true,
    });

    return res.status(200).json({ success: true, sync });
  } catch (error: any) {
    console.error("[GCAL][SELECT]", error?.message || error);
    return res.status(500).json({ error: "Не удалось выбрать календарь." });
  }
});

app.post("/api/integrations/google-calendar/sync", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.body?.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены." });
  }

  try {
    const sync = await googleCalendar.syncCalendarEvents({
      db,
      userId,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      webhookUrl: resolveCalendarWebhookUrl(req),
    });
    return res.status(200).json({ success: true, sync });
  } catch (error: any) {
    console.error("[GCAL][SYNC]", error?.message || error);
    return res.status(500).json({ error: "Не удалось синхронизировать календарь." });
  }
});

app.post("/api/integrations/google-calendar/disconnect", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "База данных не настроена (DATABASE_URL)." });
  }

  const userId = String(req.body?.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId обязателен." });
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET не настроены." });
  }

  try {
    await googleCalendar.disconnectCalendar({ db, userId, clientId: googleClientId, clientSecret: googleClientSecret });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("[GCAL][DISCONNECT]", error?.message || error);
    return res.status(500).json({ error: "Не удалось отключить Google Calendar." });
  }
});

app.post("/api/integrations/google-calendar/tool/create-event", async (req, res) => {
  if (!db) return res.status(500).json({ error: "DB not configured." });

  const userId = String(req.body?.userId || '').trim();
  const task = req.body?.task || null;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) return res.status(500).json({ error: 'Google client config missing' });

  try {
    if (task && task.id) {
      // Ensure task exists in DB (upsert) then sync
      await db.query(
        `INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, updated_at)
         VALUES ($1,$2,$3,$4,$5,false,'regular','[]',NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, time = EXCLUDED.time, date = EXCLUDED.date, updated_at = NOW()`,
        [String(task.id), userId, String(task.name || 'Без названия'), String(task.time || ''), String(task.date || new Date().toISOString().slice(0,10))]
      );

      const result = await googleCalendar.syncTaskToGoogle({
        db,
        userId,
        task: { id: String(task.id), name: String(task.name), time: String(task.time || ''), date: String(task.date) },
        clientId: googleClientId,
        clientSecret: googleClientSecret
      });
      if ((result as any)?.skipped) {
        return res.status(409).json({ success: false, error: (result as any).reason || 'calendar_not_selected', result });
      }
      const calendarStatus = await googleCalendar.getCalendarStatus(db, userId);
      return res.status(200).json({ success: true, result, calendar: calendarStatus.calendar || null });
    }

    // Create ad-hoc task if no id provided
    const newId = crypto.randomUUID();
    const name = String(req.body?.name || 'Без названия');
    const date = String(req.body?.date || new Date().toISOString().slice(0,10));
    const time = String(req.body?.time || '');

    await db.query(`INSERT INTO user_tasks (id, user_id, name, time, date, done, type, subtasks, created_at, updated_at)
                    VALUES ($1,$2,$3,$4,$5,false,'regular','[]',NOW(),NOW())`, [newId, userId, name, time, date]);

    const result = await googleCalendar.syncTaskToGoogle({ db, userId, task: { id: newId, name, time, date }, clientId: googleClientId, clientSecret: googleClientSecret });
    if ((result as any)?.skipped) {
      return res.status(409).json({ success: false, error: (result as any).reason || 'calendar_not_selected', result });
    }
    const calendarStatus = await googleCalendar.getCalendarStatus(db, userId);
    return res.status(200).json({ success: true, result, calendar: calendarStatus.calendar || null });
  } catch (error: any) {
    console.error('[GCAL][TOOL][CREATE]', error?.message || error);
    return res.status(500).json({ error: 'Failed to create event' });
  }
});

app.post("/api/integrations/google-calendar/tool/update-event", async (req, res) => {
  if (!db) return res.status(500).json({ error: "DB not configured." });
  const userId = String(req.body?.userId || '').trim();
  const task = req.body?.task || null;
  if (!userId || !task || !task.id) return res.status(400).json({ error: 'userId and task.id required' });

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) return res.status(500).json({ error: 'Google client config missing' });

  try {
    await db.query(`UPDATE user_tasks SET name=$1, time=$2, date=$3, updated_at=NOW() WHERE id=$4 AND user_id=$5`, [String(task.name || ''), String(task.time || ''), String(task.date || ''), String(task.id), userId]);
    const result = await googleCalendar.syncTaskToGoogle({ db, userId, task: { id: String(task.id), name: String(task.name), time: String(task.time || ''), date: String(task.date || '') }, clientId: googleClientId, clientSecret: googleClientSecret });
    if ((result as any)?.skipped) {
      return res.status(409).json({ success: false, error: (result as any).reason || 'calendar_not_selected', result });
    }
    const calendarStatus = await googleCalendar.getCalendarStatus(db, userId);
    return res.status(200).json({ success: true, result, calendar: calendarStatus.calendar || null });
  } catch (error: any) {
    console.error('[GCAL][TOOL][UPDATE]', error?.message || error);
    return res.status(500).json({ error: 'Failed to update event' });
  }
});

app.post("/api/integrations/google-calendar/tool/delete-event", async (req, res) => {
  if (!db) return res.status(500).json({ error: "DB not configured." });
  const userId = String(req.body?.userId || '').trim();
  const taskId = String(req.body?.taskId || '').trim();
  if (!userId || !taskId) return res.status(400).json({ error: 'userId and taskId required' });

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) return res.status(500).json({ error: 'Google client config missing' });

  try {
    const result = await googleCalendar.deleteTaskFromGoogle({ db, userId, taskId, clientId: googleClientId, clientSecret: googleClientSecret });
    if ((result as any)?.skipped) {
      return res.status(409).json({ success: false, error: (result as any).reason || 'calendar_not_selected', result });
    }
    const calendarStatus = await googleCalendar.getCalendarStatus(db, userId);
    return res.status(200).json({ success: true, result, calendar: calendarStatus.calendar || null });
  } catch (error: any) {
    console.error('[GCAL][TOOL][DELETE]', error?.message || error);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
});

app.get("/api/integrations/google-calendar/tool/list-events", async (req, res) => {
  if (!db) return res.status(500).json({ error: "DB not configured." });
  const userId = String(req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) return res.status(500).json({ error: 'Google client config missing' });

  try {
    const tokens = await googleCalendar.getValidAccessToken(db, userId, googleClientId, googleClientSecret);
    const resp = await googleCalendar.listEvents({ accessToken: tokens.access_token, calendarId: tokens.calendar_id || 'primary' });
    const mapped = (resp.events || []).map((e: any) => googleCalendar.eventToTaskFields(e, tokens.calendar_time_zone || undefined));
    const calendarStatus = await googleCalendar.getCalendarStatus(db, userId);
    return res.status(200).json({ success: true, events: mapped, calendar: calendarStatus.calendar || null });
  } catch (error: any) {
    console.error('[GCAL][TOOL][LIST]', error?.message || error);
    return res.status(500).json({ error: 'Failed to list events' });
  }
});

app.post("/api/integrations/google-calendar/webhook", async (req, res) => {
  if (!db) {
    return res.status(500).end();
  }

  const channelId = String(req.headers['x-goog-channel-id'] || '').trim();
  if (!channelId) {
    return res.status(400).end();
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return res.status(500).end();
  }

  try {
    const target = await googleCalendar.findWebhookTarget(db, channelId);
    if (!target) {
      return res.status(404).end();
    }
    await googleCalendar.syncCalendarEvents({
      db,
      userId: target.user_id,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      webhookUrl: resolveCalendarWebhookUrl(req),
    });
  } catch (error: any) {
    console.error("[GCAL][WEBHOOK]", error?.message || error);
  }

  return res.status(200).end();
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
          SELECT id, name, time, date, done, type, subtasks,
                 external_provider, external_id, external_calendar_id,
                 external_updated_at, external_synced_at
          FROM user_tasks
          WHERE user_id = $1
          ORDER BY updated_at DESC, created_at DESC
        `,
        [userId]
      ),
      db.query(
        `
          SELECT id, title, preview, messages, created_at
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
        externalProvider: row.external_provider || undefined,
        externalId: row.external_id || undefined,
        externalCalendarId: row.external_calendar_id || undefined,
        externalUpdatedAt: row.external_updated_at || undefined,
        externalSyncedAt: row.external_synced_at || undefined,
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
        String(thread.title || "Новая мысль"),
        String(thread.preview || ""),
        JSON.stringify(thread.messages || []),
        Number(thread.createdAt || Date.now()),
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
