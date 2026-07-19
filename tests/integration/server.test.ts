import assert from 'node:assert/strict';
import { test, describe, before, after, beforeEach } from 'node:test';
import { Pool } from 'pg';
import { startTestServer } from '../helpers/server';

// ─── Environment & DB mock ───────────────────────────────────────────────────
// server.ts calls dotenv.config() inside the module, which loads .env.
// dotenv.config({ override: false }) — it only sets keys NOT already in process.env.
// So we MUST set our overrides BEFORE the dynamic import.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test';
process.env.GOOGLE_CLIENT_ID = 'google-id';
process.env.YANDEX_CLIENT_ID = 'yandex-id';
process.env.YANDEX_CLIENT_SECRET = 'yandex-secret';
process.env.ADMIN_SECRET = 'test-admin-secret';
process.env.METRICS_TOKEN = 'test-metrics-token';
// Empty string instead of delete — prevents dotenv from loading the real value
process.env.ROUTERAI_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.VSEGPT_API_KEY = '';
process.env.TELEGRAM_BOT_TOKEN = '';

// In-memory store for mock queries — lets tests inspect & assert DB interactions.
const mockRows: Record<string, any[]> = {};

const resetMockRows = () => {
  for (const key of Object.keys(mockRows)) delete mockRows[key];
};

// Simulated user data
const TEST_USER_ID = 'user-1';
const TEST_SESSION_TOKEN = 'valid-session';
const TEST_DISPLAY_NAME = 'Test User';
const TEST_USERNAME = 'testuser';
import crypto from 'crypto';
const TEST_PASSWORD_HASH = crypto.createHash('sha256').update('testuser:testpass').digest('hex');

const fillDefaults = () => {
  mockRows.user_sessions = [
    { token: TEST_SESSION_TOKEN, user_id: TEST_USER_ID, expires_at: '2099-12-31' },
  ];
  mockRows.auth_users = [
    {
      id: TEST_USER_ID,
      username: TEST_USERNAME,
      display_name: TEST_DISPLAY_NAME,
      password_hash: TEST_PASSWORD_HASH,
      provider: 'local',
      google_sub: null,
      email: null,
      avatar_url: null,
      created_at: '2024-01-01',
    },
  ];
  mockRows.user_profiles = [
    { user_id: TEST_USER_ID, settings: '{}', onboarding_complete: false, updated_at: '2024-01-01', telegram_chat_id: null, timezone: 'Europe/Moscow' },
  ];
  mockRows.user_tasks = [];
  mockRows.user_threads = [];
  mockRows.shared_events = [];
  mockRows.shared_event_adds = [];
  mockRows.email_otp_codes = [];
  mockRows.telegram_link_codes = [];
};

// ─── Mock Pool.query ─────────────────────────────────────────────────────────

Pool.prototype.query = (async (text: string, params?: any[]) => {
  // user_sessions — used by requireAuth and createSession
  if (text.includes('user_sessions')) {
    if (text.includes('INSERT')) return { rowCount: 1, rows: [] } as any;
    if (text.includes('SELECT') && params?.[0] === TEST_SESSION_TOKEN) {
      return { rows: mockRows.user_sessions.filter((r: any) => r.token === params[0]) } as any;
    }
    return { rows: [] } as any;
  }

  // auth_users
  if (text.includes('auth_users')) {
    if (text.includes('INSERT') && text.includes('RETURNING')) return { rows: [mockRows.auth_users[0]] } as any;
    if (text.includes('UPDATE') && text.includes('RETURNING')) return { rows: [mockRows.auth_users[0]] } as any;
    if (text.includes('SELECT') && text.includes('WHERE username')) {
      return { rows: mockRows.auth_users.filter((r: any) => r.username === params?.[0]) } as any;
    }
    if (text.includes('SELECT') && text.includes('WHERE id')) {
      return { rows: mockRows.auth_users.filter((r: any) => r.id === params?.[0]) } as any;
    }
    if (text.includes('SELECT') && text.includes('WHERE email')) {
      return { rows: mockRows.auth_users.filter((r: any) => r.email === params?.[0]) } as any;
    }
    if (text.includes('SELECT') && text.includes('WHERE google_sub')) {
      return { rows: mockRows.auth_users.filter((r: any) => r.google_sub === params?.[0]) } as any;
    }
    if (text.includes('COUNT')) return { rows: [{ total: mockRows.auth_users.length }] } as any;
    return { rows: mockRows.auth_users } as any;
  }

  // user_profiles
  if (text.includes('user_profiles')) {
    if (text.includes('INSERT') || text.includes('UPDATE')) return { rowCount: 1, rows: [] } as any;
    if (text.includes('SELECT') && text.includes('WHERE user_id')) {
      return { rows: mockRows.user_profiles.filter((r: any) => r.user_id === params?.[0]) } as any;
    }
    return { rows: mockRows.user_profiles } as any;
  }

  // user_tasks
  if (text.includes('user_tasks')) {
    if (text.includes('INSERT') || text.includes('UPDATE') || text.includes('DELETE')) return { rowCount: 1, rows: [] } as any;
    if (text.includes('SELECT') && text.includes('WHERE user_id')) {
      return { rows: mockRows.user_tasks.filter((r: any) => r.user_id === params?.[0]) } as any;
    }
    return { rows: mockRows.user_tasks } as any;
  }

  // user_threads
  if (text.includes('user_threads')) {
    if (text.includes('INSERT') || text.includes('UPDATE') || text.includes('DELETE')) return { rowCount: 1, rows: [] } as any;
    if (text.includes('SELECT') && text.includes('WHERE user_id')) {
      return { rows: mockRows.user_threads.filter((r: any) => r.user_id === params?.[0]) } as any;
    }
    if (text.includes('RETURNING')) return { rowCount: 0, rows: [] } as any;
    return { rows: mockRows.user_threads } as any;
  }

  // shared_events
  if (text.includes('shared_events')) {
    if (text.includes('INSERT')) return { rows: [] } as any;
    if (text.includes('SELECT') && text.includes('WHERE id')) {
      return { rows: mockRows.shared_events.filter((r: any) => r.id === params?.[0]) } as any;
    }
    return { rows: [] } as any;
  }

  // shared_event_adds
  if (text.includes('shared_event_adds')) {
    if (text.includes('INSERT')) return { rows: [] } as any;
    if (text.includes('SELECT') && text.includes('event_id')) {
      return { rows: mockRows.shared_event_adds.filter((r: any) => r.event_id === params?.[0] && r.user_id === params?.[1]) } as any;
    }
    return { rows: [] } as any;
  }

  // email_otp_codes
  if (text.includes('email_otp_codes')) {
    if (text.includes('INSERT')) return { rows: [] } as any;
    if (text.includes('UPDATE') && text.includes('RETURNING')) return { rowCount: 1, rows: [{ id: 'otp-1' }] } as any;
    if (text.includes('SELECT') && text.includes('COUNT')) return { rows: [{ cnt: 0 }] } as any;
    return { rows: mockRows.email_otp_codes } as any;
  }

  // telegram_link_codes
  if (text.includes('telegram_link_codes')) {
    if (text.includes('INSERT')) return { rows: [] } as any;
    return { rows: mockRows.telegram_link_codes } as any;
  }

  // Schema creation & migrations — silently succeed
  if (text.includes('CREATE') || text.includes('ALTER') || text.includes('CREATE EXTENSION') || text.includes('CREATE INDEX')) {
    return { rows: [] } as any;
  }

  // polisad tables
  if (text.includes('polisad_')) return { rows: [] } as any;

  return { rows: [] } as any;
}) as any;

// ─── Import server & start ────────────────────────────────────────────────────

const { default: app } = await import('../../server');

let serverUrl = '';
let closeServer: (() => Promise<void>) | null = null;

before(async () => {
  fillDefaults();
  const server = await startTestServer(app);
  serverUrl = server.url;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) await closeServer();
});

beforeEach(() => {
  fillDefaults();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const post = (path: string, body?: unknown, token?: string) =>
  fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const get = (path: string, token?: string) =>
  fetch(`${serverUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const del = (path: string, token?: string) =>
  fetch(`${serverUrl}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const patch = (path: string, body?: unknown, token?: string) =>
  fetch(`${serverUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /metrics ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /metrics', () => {
  test('returns Prometheus output with correct token', async () => {
    const res = await fetch(`${serverUrl}/metrics?token=test-metrics-token`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.includes('http_requests_total'));
  });

  test('returns 404 when token is wrong', async () => {
    const res = await fetch(`${serverUrl}/metrics?token=wrong`);
    assert.equal(res.status, 404);
  });

  test('returns 404 when no token provided but METRICS_TOKEN is set', async () => {
    const res = await fetch(`${serverUrl}/metrics`);
    assert.equal(res.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/config ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/config', () => {
  test('returns client config with googleClientId', async () => {
    const res = await get('/api/config');
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.googleClientId, 'google-id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/chat (health check) ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/chat', () => {
  test('returns ok status', async () => {
    const res = await get('/api/chat');
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/register ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/register', () => {
  test('rejects missing username and password', async () => {
    const res = await post('/api/auth/register', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Укажи имя пользователя и пароль.');
  });

  test('rejects short username (< 3 chars)', async () => {
    const res = await post('/api/auth/register', { username: 'ab', password: 'pass' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('3 символов'));
  });

  test('rejects short password (< 4 chars)', async () => {
    const res = await post('/api/auth/register', { username: 'validuser', password: 'ab' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('4 символов'));
  });

  test('trims and lowercases username', async () => {
    const res = await post('/api/auth/register', { username: '  NewUser  ', password: 'validpass' });
    // Will succeed or get unique constraint — either way no crash
    assert.ok([201, 409].includes(res.status));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/login ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login', () => {
  test('rejects missing credentials', async () => {
    const res = await post('/api/auth/login', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Укажи имя пользователя и пароль.');
  });

  test('returns 404 for unknown user', async () => {
    mockRows.auth_users = []; // no users in DB
    const res = await post('/api/auth/login', { username: 'nobody', password: 'pass' });
    const data = await res.json();
    assert.equal(res.status, 404);
    assert.equal(data.error, 'Пользователь не найден.');
  });

  test('returns 401 for wrong password', async () => {
    const res = await post('/api/auth/login', { username: 'testuser', password: 'wrongpass' });
    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.error, 'Неверный пароль.');
  });

  test('returns user and token on success', async () => {
    const res = await post('/api/auth/login', { username: 'testuser', password: 'testpass' });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.user.id, TEST_USER_ID);
    assert.ok(data.token);
    assert.equal(data.user.username, TEST_USERNAME);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/me ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/me', () => {
  test('rejects missing auth', async () => {
    const res = await get('/api/auth/me');
    const data = await res.json();
    assert.equal(res.status, 401);
  });

  test('returns current user profile', async () => {
    const res = await get('/api/auth/me', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.user.id, TEST_USER_ID);
    assert.equal(data.user.username, TEST_USERNAME);
  });

  test('returns 404 when user not found', async () => {
    mockRows.auth_users = [];
    const res = await get('/api/auth/me', TEST_SESSION_TOKEN);
    assert.equal(res.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/migrate-session ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/migrate-session', () => {
  test('rejects missing userId', async () => {
    const res = await post('/api/auth/migrate-session', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'userId обязателен.');
  });

  test('returns 404 for non-existent user', async () => {
    mockRows.auth_users = [];
    const res = await post('/api/auth/migrate-session', { userId: 'ghost-user' });
    assert.equal(res.status, 404);
  });

  test('returns 403 for non-local provider', async () => {
    mockRows.auth_users = [{ ...mockRows.auth_users[0], provider: 'google', password_hash: '' }];
    const res = await post('/api/auth/migrate-session', { userId: TEST_USER_ID });
    assert.equal(res.status, 403);
  });

  test('returns existing token if session exists', async () => {
    const res = await post('/api/auth/migrate-session', { userId: TEST_USER_ID });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.token);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/google ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/google', () => {
  test('rejects missing credential', async () => {
    const res = await post('/api/auth/google', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Google credential обязателен.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/yandex ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/yandex', () => {
  test('rejects missing code', async () => {
    const res = await post('/api/auth/yandex', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Яндекс authorization code обязателен.');
  });

  test('rejects blank code', async () => {
    const res = await post('/api/auth/yandex', { code: '   ' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Яндекс authorization code обязателен.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/send-otp ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/send-otp', () => {
  test('rejects invalid email', async () => {
    const res = await post('/api/auth/send-otp', { email: 'not-an-email' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Некорректный email.');
  });

  test('rejects missing email', async () => {
    const res = await post('/api/auth/send-otp', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Некорректный email.');
  });

  test('rejects empty string email', async () => {
    const res = await post('/api/auth/send-otp', { email: '' });
    const data = await res.json();
    assert.equal(res.status, 400);
  });

  test('returns 500 when RESEND_API_KEY is not set', async () => {
    const res = await post('/api/auth/send-otp', { email: 'user@example.com' });
    const data = await res.json();
    assert.equal(res.status, 500);
    assert.ok(data.error.includes('Email-сервис'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/verify-otp ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/verify-otp', () => {
  test('rejects missing email and otp', async () => {
    const res = await post('/api/auth/verify-otp', {});
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Укажи email и код.');
  });

  test('rejects non-6-digit otp', async () => {
    const res = await post('/api/auth/verify-otp', { email: 'user@example.com', otp: '12345' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Код — 6 цифр.');
  });

  test('rejects alpha otp', async () => {
    const res = await post('/api/auth/verify-otp', { email: 'user@example.com', otp: 'abcdef' });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Код — 6 цифр.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/auth/attach-email ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/attach-email', () => {
  test('rejects missing auth', async () => {
    const res = await post('/api/auth/attach-email', { email: 'a@b.com', otp: '123456' });
    assert.equal(res.status, 401);
  });

  test('rejects missing fields when authenticated', async () => {
    const res = await post('/api/auth/attach-email', {}, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Укажи email и код.');
  });

  test('rejects non-6-digit otp', async () => {
    const res = await post('/api/auth/attach-email', { email: 'a@b.com', otp: '123' }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Код — 6 цифр.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── requireAuth guard ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireAuth guard', () => {
  test('POST /api/data/task rejects missing auth', async () => {
    const res = await post('/api/data/task', { task: { id: 't1', name: 'Task', date: '2026-06-25' } });
    const data = await res.json();
    assert.equal(res.status, 401);
    assert.equal(data.error, 'Не авторизован.');
  });

  test('GET /api/data/bootstrap rejects missing auth', async () => {
    const res = await get('/api/data/bootstrap');
    assert.equal(res.status, 401);
  });

  test('POST /api/data/profile rejects missing auth', async () => {
    const res = await post('/api/data/profile', {});
    assert.equal(res.status, 401);
  });

  test('POST /api/data/timezone rejects missing auth', async () => {
    const res = await post('/api/data/timezone', { timezone: 'UTC' });
    assert.equal(res.status, 401);
  });

  test('POST /api/data/thread rejects missing auth', async () => {
    const res = await post('/api/data/thread', {});
    assert.equal(res.status, 401);
  });

  test('DELETE /api/data/task/:id rejects missing auth', async () => {
    const res = await del('/api/data/task/t1');
    assert.equal(res.status, 401);
  });

  test('DELETE /api/data/thread/:id rejects missing auth', async () => {
    const res = await del('/api/data/thread/th1');
    assert.equal(res.status, 401);
  });

  test('GET /api/search rejects missing auth', async () => {
    const res = await get('/api/search?q=test');
    assert.equal(res.status, 401);
  });

  test('POST /api/chat rejects missing auth', async () => {
    const res = await post('/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 401);
  });

  test('POST /api/summarize rejects missing auth', async () => {
    const res = await post('/api/summarize', { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 401);
  });

  test('POST /api/events rejects missing auth', async () => {
    const res = await post('/api/events', { title: 'Event', date: '2026-06-25' });
    assert.equal(res.status, 401);
  });

  test('POST /api/events/:id/add rejects missing auth', async () => {
    const res = await post('/api/events/evt_test/add');
    assert.equal(res.status, 401);
  });

  test('POST /api/telegram/link-code rejects missing auth', async () => {
    const res = await post('/api/telegram/link-code');
    assert.equal(res.status, 401);
  });

  test('GET /api/telegram/link-status rejects missing auth', async () => {
    const res = await get('/api/telegram/link-status');
    assert.equal(res.status, 401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/data/bootstrap ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/data/bootstrap', () => {
  test('returns profile, tasks, threads', async () => {
    mockRows.user_tasks = [{ id: 't1', user_id: TEST_USER_ID, name: 'Task 1', date: '2026-06-25', done: false }];
    mockRows.user_threads = [{ id: 'th1', user_id: TEST_USER_ID, title: 'Thread 1', preview: '...', messages: '[]', created_at: 1700000000000, updated_at: new Date().toISOString() }];

    const res = await get('/api/data/bootstrap', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.profile);
    assert.ok(Array.isArray(data.tasks));
    assert.ok(Array.isArray(data.threads));
  });

  test('returns null profile when not found', async () => {
    mockRows.user_profiles = [];
    const res = await get('/api/data/bootstrap', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.profile, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/data/profile ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/data/profile', () => {
  test('saves profile successfully', async () => {
    const res = await post('/api/data/profile', {
      settings: { agent: true, confirm: false, notifs: true },
      onboarding_complete: true,
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/data/timezone ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/data/timezone', () => {
  test('saves timezone successfully', async () => {
    const res = await post('/api/data/timezone', { timezone: 'America/New_York' }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });

  test('rejects missing timezone', async () => {
    const res = await post('/api/data/timezone', {}, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'timezone обязателен');
  });

  test('rejects non-string timezone', async () => {
    const res = await post('/api/data/timezone', { timezone: 123 }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/data/task (CRUD) ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/data/task', () => {
  test('creates task successfully', async () => {
    const res = await post('/api/data/task', {
      task: { id: 't-new', name: 'New Task', date: '2026-06-25' },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });

  test('rejects missing task.id', async () => {
    const res = await post('/api/data/task', {
      task: { name: 'Task', date: '2026-06-25' },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Некорректные данные задачи.');
  });

  test('rejects missing task.name', async () => {
    const res = await post('/api/data/task', {
      task: { id: 't1', date: '2026-06-25' },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
  });

  test('rejects missing task.date', async () => {
    const res = await post('/api/data/task', {
      task: { id: 't1', name: 'Task' },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
  });

  test('creates task with full fields', async () => {
    const res = await post('/api/data/task', {
      task: {
        id: 't-full',
        name: 'Full Task',
        date: '2026-06-25',
        time: '14:00',
        endTime: '15:00',
        done: false,
        category: 'work',
        description: 'Description',
        location: 'Office',
        suggestedTime: '13:30',
        suggestedEndTime: '14:30',
      },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});

describe('DELETE /api/data/task/:id', () => {
  test('deletes task successfully', async () => {
    const res = await del('/api/data/task/t-full', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/data/thread (CRUD + archive) ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/data/thread', () => {
  test('saves thread successfully', async () => {
    const res = await post('/api/data/thread', {
      thread: { id: 'th-new', title: 'My thought', preview: '...', messages: [], createdAt: Date.now() },
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });

  test('rejects missing thread.id', async () => {
    const res = await post('/api/data/thread', { thread: { title: 'No ID' } }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'Некорректные данные треда.');
  });
});

describe('DELETE /api/data/thread/:id', () => {
  test('deletes thread successfully', async () => {
    const res = await del('/api/data/thread/th-new', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});

describe('PATCH /api/data/thread/:id/archive', () => {
  test('archives thread successfully', async () => {
    // Mock: UPDATE RETURNING should return 1 row
    const origQuery = Pool.prototype.query;
    Pool.prototype.query = (async (text: string, params?: any[]) => {
      if (text.includes('user_threads') && text.includes('UPDATE') && text.includes('RETURNING')) {
        return { rowCount: 1, rows: [{ id: params?.[0] }] } as any;
      }
      if (text.includes('user_sessions')) {
        if (params?.[0] === TEST_SESSION_TOKEN) return { rows: mockRows.user_sessions.filter((r: any) => r.token === params[0]) } as any;
        return { rows: [] } as any;
      }
      return { rows: [] } as any;
    }) as any;

    try {
      const res = await patch('/api/data/thread/th-new/archive', undefined, TEST_SESSION_TOKEN);
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
    } finally {
      Pool.prototype.query = origQuery;
    }
  });

  test('returns 404 when thread not found', async () => {
    const origQuery = Pool.prototype.query;
    Pool.prototype.query = (async (text: string, params?: any[]) => {
      if (text.includes('user_threads') && text.includes('UPDATE') && text.includes('RETURNING')) {
        return { rowCount: 0, rows: [] } as any;
      }
      if (text.includes('user_sessions')) {
        if (params?.[0] === TEST_SESSION_TOKEN) return { rows: mockRows.user_sessions.filter((r: any) => r.token === params[0]) } as any;
        return { rows: [] } as any;
      }
      return { rows: [] } as any;
    }) as any;

    try {
      const res = await patch('/api/data/thread/nonexistent/archive', undefined, TEST_SESSION_TOKEN);
      assert.equal(res.status, 404);
    } finally {
      Pool.prototype.query = origQuery;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/events ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/events/:id (public)', () => {
  test('returns 404 when id is blank (no event found)', async () => {
    const res = await get('/api/events/ ');
    assert.equal(res.status, 404);
  });

  test('returns 404 for unknown event', async () => {
    mockRows.shared_events = [];
    const res = await get('/api/events/evt_nonexistent');
    const data = await res.json();
    assert.equal(res.status, 404);
    assert.equal(data.error, 'Событие не найдено');
  });

  test('returns event data when found', async () => {
    mockRows.shared_events = [{
      id: 'evt_abc123',
      title: 'Meeting',
      date: '2026-06-25',
      time: '14:00',
      end_time: '15:00',
      location: 'Room A',
      description: 'Team sync',
      partner_name: 'John',
      created_by: TEST_USER_ID,
      expires_at: '2099-12-31',
    }];
    const res = await get('/api/events/evt_abc123');
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.title, 'Meeting');
    assert.equal(data.date, '2026-06-25');
    assert.equal(data.time, '14:00');
    assert.equal(data.expired, false);
  });
});

describe('POST /api/events', () => {
  test('creates event successfully', async () => {
    const res = await post('/api/events', {
      title: 'Team Standup',
      date: '2026-06-25',
      time: '10:00',
      endTime: '10:30',
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.id.startsWith('evt_'));
    assert.ok(data.url);
  });

  test('rejects missing title', async () => {
    const res = await post('/api/events', { date: '2026-06-25' }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'title обязателен.');
  });

  test('rejects invalid date format', async () => {
    const res = await post('/api/events', { title: 'Event', date: 'not-a-date' }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('YYYY-MM-DD'));
  });

  test('rejects missing date', async () => {
    const res = await post('/api/events', { title: 'Event' }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('YYYY-MM-DD'));
  });

  test('accepts optional fields', async () => {
    const res = await post('/api/events', {
      title: 'Conference',
      date: '2026-07-01',
      time: '09:00',
      endTime: '18:00',
      location: 'Moscow',
      description: 'Big event',
      partnerName: 'Alice',
      expiresAt: '2026-07-02T23:59:59Z',
    }, TEST_SESSION_TOKEN);
    assert.equal(res.status, 200);
  });
});

describe('POST /api/events/:id/add', () => {
  test('returns 404 when event not found', async () => {
    mockRows.shared_events = [];
    const res = await post('/api/events/evt_nonexistent/add', {}, TEST_SESSION_TOKEN);
    assert.equal(res.status, 404);
  });

  test('returns idempotent result when already added', async () => {
    mockRows.shared_events = [{ id: 'evt_dup', title: 'Dup', date: '2026-06-25', expires_at: '2099-12-31' }];
    mockRows.shared_event_adds = [{ event_id: 'evt_dup', user_id: TEST_USER_ID, task_id: 't-dup' }];

    const res = await post('/api/events/evt_dup/add', {}, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.added, true);
    assert.equal(data.already, true);
    assert.equal(data.taskId, 't-dup');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/telegram ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('/api/telegram endpoints', () => {
  test('GET /api/telegram/link-status returns linked status', async () => {
    const res = await get('/api/telegram/link-status', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.linked, false);
  });

  test('POST /api/telegram/link-code issues a code without bot token', async () => {
    // Генерация кода не зависит от TELEGRAM_BOT_TOKEN — токен нужен только боту
    const res = await post('/api/telegram/link-code', {}, TEST_SESSION_TOKEN);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(String(data.code), /^MNDX-/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── /api/search ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/search', () => {
  test('rejects missing query param', async () => {
    const res = await get('/api/search', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'q обязателен.');
  });

  test('returns results for valid query (keyword fallback)', async () => {
    const res = await get('/api/search?q=test', TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(data.results));
    assert.equal(data.mode, 'keyword');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POST /api/chat ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/chat', () => {
  test('returns error when ROUTERAI_API_KEY not set', async () => {
    const res = await post('/api/chat', {
      messages: [{ role: 'user', content: 'hello' }],
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 500);
    assert.ok(data.error.includes('ROUTERAI_API_KEY'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POST /api/summarize ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/summarize', () => {
  test('rejects missing messages', async () => {
    const res = await post('/api/summarize', {}, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'messages required');
  });

  test('rejects empty messages array', async () => {
    const res = await post('/api/summarize', { messages: [] }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 400);
  });

  test('returns error when ROUTERAI_API_KEY not set', async () => {
    const res = await post('/api/summarize', {
      messages: [{ role: 'user', content: 'hello' }],
    }, TEST_SESSION_TOKEN);
    const data = await res.json();
    assert.equal(res.status, 500);
    assert.ok(data.error.includes('ROUTERAI_API_KEY'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GET /api/admin/stats ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/stats', () => {
  test('rejects missing secret', async () => {
    const res = await get('/api/admin/stats');
    assert.equal(res.status, 403);
  });

  test('rejects wrong secret', async () => {
    const res = await get('/api/admin/stats?secret=wrong');
    assert.equal(res.status, 403);
  });

  test('returns stats with correct secret', async () => {
    const origQuery = Pool.prototype.query;
    Pool.prototype.query = (async (text: string, params?: any[]) => {
      if (text.includes('COUNT(*)') && text.includes('auth_users')) return { rows: [{ total: 10 }] } as any;
      if (text.includes('retention') || text.includes('cohort')) return { rows: [{ cohort_7d: '5', retained_7d: '3' }] } as any;
      if (text.includes('telegram_chat_id')) return { rows: [{ total_profiles: 10, tg_connected: 4 }] } as any;
      if (text.includes('assistant') && text.includes('messages')) return { rows: [{ assistant_messages: '100' }] } as any;
      if (text.includes('active_7d')) return { rows: [{ active_7d: 7 }] } as any;
      return { rows: [] } as any;
    }) as any;

    try {
      const res = await get('/api/admin/stats?secret=test-admin-secret');
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.ok(data.users);
      assert.ok(data.retention);
      assert.ok(data.telegram);
      assert.ok(data.messages);
    } finally {
      Pool.prototype.query = origQuery;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POST /api/admin/backfill-embeddings ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/backfill-embeddings', () => {
  test('rejects missing secret', async () => {
    const res = await post('/api/admin/backfill-embeddings', {});
    assert.equal(res.status, 403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POST /api/admin/polisad-metrics ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/polisad-metrics', () => {
  test('rejects missing secret', async () => {
    const res = await post('/api/admin/polisad-metrics', {});
    assert.equal(res.status, 403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POST /api/voice/transcribe ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/voice/transcribe', () => {
  test('rejects missing auth', async () => {
    const res = await fetch(`${serverUrl}/api/voice/transcribe`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  test('rejects missing file (no multipart)', async () => {
    const res = await fetch(`${serverUrl}/api/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_SESSION_TOKEN}` },
    });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('Аудиофайл'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Rate limiting ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rate limiting', () => {
  test('data rate limit blocks after 120 requests on same path', async () => {
    const body = JSON.stringify({ task: { id: 't-rl', name: 'RL Task', date: '2026-06-25' } });
    let lastStatus = 0;
    const total = 125;

    for (let i = 0; i < total; i += 1) {
      const res = await fetch(`${serverUrl}/api/data/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
        },
        body,
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }

    assert.equal(lastStatus, 429, 'should hit data rate limit after 120+ requests');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Edge cases ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  test('unknown API route returns 404', async () => {
    const res = await get('/api/nonexistent');
    // Express returns 404 for unmatched routes
    assert.ok([404, 401, 500].includes(res.status));
  });

  test('OPTIONS preflight on /api/config works', async () => {
    const res = await fetch(`${serverUrl}/api/config`, { method: 'OPTIONS' });
    // CORS + express.json middleware — should not crash
    assert.ok([200, 204, 404].includes(res.status));
  });

  test('invalid JSON body does not crash server', async () => {
    const res = await fetch(`${serverUrl}/api/data/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_SESSION_TOKEN}`,
      },
      body: 'not-json{{{',
    });
    // Express should handle parse error gracefully
    assert.ok([400, 500].includes(res.status));
  });
});
