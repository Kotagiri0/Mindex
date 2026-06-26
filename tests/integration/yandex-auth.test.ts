import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { Pool } from 'pg';
import { startTestServer } from '../helpers/server';
import { jsonResponse } from '../helpers/response';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test';
process.env.GOOGLE_CLIENT_ID = 'google-id';
process.env.YANDEX_CLIENT_ID = 'yandex-id';
process.env.YANDEX_CLIENT_SECRET = 'yandex-secret';

// --- Управляемое состояние БД для каждого сценария ---
type Row = Record<string, any>;
const dbState: {
  byYandexId: Row[];
  byEmail: Row[];
  usernameTaken: boolean;
  calls: { kind: string; text: string; params?: any[] }[];
} = { byYandexId: [], byEmail: [], usernameTaken: false, calls: [] };

beforeEach(() => {
  dbState.byYandexId = [];
  dbState.byEmail = [];
  dbState.usernameTaken = false;
  dbState.calls = [];
});

Pool.prototype.query = (async (text: string, params?: any[]) => {
  const t = String(text);
  // сессии: createSession пишет токен (значение генерится в JS)
  if (t.includes('user_sessions')) { dbState.calls.push({ kind: 'session', text: t, params }); return { rows: [] }; }
  if (t.includes('SELECT id FROM auth_users WHERE username')) {
    return { rows: dbState.usernameTaken ? [{ id: 'someone' }] : [] };
  }
  if (t.includes('WHERE yandex_id =')) {
    dbState.calls.push({ kind: 'selByYandex', text: t, params });
    return { rows: dbState.byYandexId };
  }
  if (t.includes('FROM auth_users WHERE email =')) {
    dbState.calls.push({ kind: 'selByEmail', text: t, params });
    return { rows: dbState.byEmail };
  }
  if (t.includes('UPDATE') && t.includes('auth_users') && t.includes('yandex_id')) {
    dbState.calls.push({ kind: 'update', text: t, params });
    return { rows: [] };
  }
  if (t.includes('INSERT INTO auth_users')) {
    dbState.calls.push({ kind: 'insert', text: t, params });
    return { rows: [{ id: params?.[0], username: params?.[1], display_name: params?.[2], provider: 'yandex', email: params?.[4] ?? null, avatar_url: params?.[5] ?? null, created_at: new Date().toISOString() }] };
  }
  // миграции, self-knowledge skill и пр.
  return { rows: [] };
}) as any;

// Мок Яндекса (token + info). Управляется через yandexInfo.
let yandexInfo: Row = { id: 'yx-1', default_email: 'user@ya.ru' };
const realFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (async (url: string, init?: any) => {
  const u = String(url);
  if (u.includes('oauth.yandex.ru/token')) return jsonResponse({ access_token: 'AT' });
  if (u.includes('login.yandex.ru/info')) return jsonResponse(yandexInfo);
  // всё остальное (если вдруг) — реальный fetch
  return realFetch(url, init);
}) as any;

const { default: app } = await import('../../server');

let serverUrl = '';
let closeServer: (() => Promise<void>) | null = null;

before(async () => {
  const s = await startTestServer(app);
  serverUrl = s.url; closeServer = s.close;
});
after(async () => { if (closeServer) await closeServer(); });

const post = (body: any) => fetch(`${serverUrl}/api/auth/yandex`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('нет кода → 400', async () => {
  const r = await post({});
  assert.equal(r.status, 400);
});

test('новый пользователь: создаётся аккаунт (INSERT), 201', async () => {
  yandexInfo = { id: 'yx-new', default_email: 'fresh@ya.ru', real_name: 'Свежий' };
  const r = await post({ code: 'c' });
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.equal(data.user.provider, 'yandex');
  assert.ok(dbState.calls.some(c => c.kind === 'insert'), 'должен быть INSERT нового аккаунта');
  assert.ok(!dbState.calls.some(c => c.kind === 'update'), 'UPDATE быть не должно');
});

test('КЛЮЧЕВОЕ: старый Google-аккаунт с тем же email → линковка (UPDATE), 200, тот же id, без дубля', async () => {
  yandexInfo = { id: 'yx-7', default_email: 'googleuser@ya.ru', real_name: 'Гугл Юзер' };
  // в БД уже есть аккаунт, заходивший через Google: google_sub есть, yandex_id пуст
  dbState.byEmail = [{
    id: 'existing-google-id', username: 'googleuser@ya.ru', display_name: 'Old',
    provider: 'google', email: 'googleuser@ya.ru', avatar_url: null,
    created_at: '2025-01-01', yandex_id: null,
  }];
  const r = await post({ code: 'c' });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.user.id, 'existing-google-id', 'должен войти в ТОТ ЖЕ аккаунт');
  assert.ok(dbState.calls.some(c => c.kind === 'update'), 'должна быть линковка через UPDATE');
  assert.ok(!dbState.calls.some(c => c.kind === 'insert'), 'дубль НЕ создаём');
});

test('RED TEAM: email принадлежит ДРУГОМУ yandex_id → 409 (защита от захвата)', async () => {
  yandexInfo = { id: 'attacker-yx', default_email: 'victim@ya.ru' };
  dbState.byEmail = [{
    id: 'victim-id', username: 'victim@ya.ru', display_name: 'Victim',
    provider: 'yandex', email: 'victim@ya.ru', avatar_url: null,
    created_at: '2025-01-01', yandex_id: 'real-victim-yx', // уже привязан к другому Яндексу
  }];
  const r = await post({ code: 'c' });
  assert.equal(r.status, 409);
  assert.ok(!dbState.calls.some(c => c.kind === 'update' || c.kind === 'insert'), 'ни UPDATE, ни INSERT при отказе');
});

test('возврат существующего Яндекс-юзера (по yandex_id) → 200, тот же аккаунт', async () => {
  yandexInfo = { id: 'yx-returning', default_email: 'ret@ya.ru' };
  dbState.byYandexId = [{
    id: 'returning-id', username: 'ret@ya.ru', display_name: 'Ret',
    provider: 'yandex', email: 'ret@ya.ru', avatar_url: null,
    created_at: '2025-01-01', yandex_id: 'yx-returning',
  }];
  const r = await post({ code: 'c' });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.user.id, 'returning-id');
  assert.ok(!dbState.calls.some(c => c.kind === 'insert'), 'без дубля');
});

test('RED TEAM: Яндекс без email → НЕ линкуемся по email, создаём новый по yandex_id', async () => {
  yandexInfo = { id: 'yx-noemail', login: 'noemail' }; // нет default_email/emails
  dbState.byEmail = [{ id: 'should-not-be-used', email: null, yandex_id: 'other' }];
  const r = await post({ code: 'c' });
  assert.equal(r.status, 201);
  assert.ok(!dbState.calls.some(c => c.kind === 'selByEmail'), 'поиск по email не должен запускаться без email');
  assert.ok(dbState.calls.some(c => c.kind === 'insert'), 'создаём новый аккаунт по yandex_id');
});
