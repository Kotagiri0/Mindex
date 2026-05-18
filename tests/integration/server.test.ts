import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { Pool } from 'pg';
import { startTestServer } from '../helpers/server';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test';
process.env.GOOGLE_CLIENT_ID = 'google-id';

Pool.prototype.query = async (text: string, params?: any[]) => {
  if (text.includes('user_sessions')) {
    if (params?.[0] === 'valid') {
      return { rows: [{ user_id: 'user-1' }] } as any;
    }
    return { rows: [] } as any;
  }
  return { rows: [] } as any;
};

const { default: app } = await import('../../server');

let serverUrl = '';
let closeServer: (() => Promise<void>) | null = null;

before(async () => {
  const server = await startTestServer(app);
  serverUrl = server.url;
  closeServer = server.close;
});

after(async () => {
  if (closeServer) {
    await closeServer();
  }
});

test('GET /api/config returns client config', async () => {
  const response = await fetch(`${serverUrl}/api/config`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.googleClientId, 'google-id');
});

test('GET /metrics returns Prometheus output', async () => {
  const response = await fetch(`${serverUrl}/metrics`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes('http_requests_total'));
});

test('POST /api/data/task rejects missing auth', async () => {
  const response = await fetch(`${serverUrl}/api/data/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: { id: 't1', name: 'Task', date: '2026-05-18' } }),
  });
  const data = await response.json();
  assert.equal(response.status, 401);
  assert.equal(data.error, 'Не авторизован.');
});

test('rate limit blocks after threshold', async () => {
  const body = JSON.stringify({ task: { id: 't1', name: 'Task', date: '2026-05-18' } });
  let lastStatus = 0;

  for (let i = 0; i < 121; i += 1) {
    const response = await fetch(`${serverUrl}/api/data/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid',
      },
      body,
    });
    lastStatus = response.status;
    if (response.status === 429) {
      break;
    }
  }

  assert.equal(lastStatus, 429);
});
