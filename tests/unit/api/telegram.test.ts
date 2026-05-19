import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/telegram';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns early when required env missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  const req = createMockReq({ method: 'POST', body: { message: { text: 'hi' } } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.ended, true);
});

test('rejects non-post methods', async () => {
  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('returns method not allowed for OPTIONS', async () => {
  const req = createMockReq({ method: 'OPTIONS' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('ignores commands and empty messages', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.VITE_SUPABASE_URL = 'url';
  process.env.VITE_SUPABASE_ANON_KEY = 'key';
  const req = createMockReq({ method: 'POST', body: { message: { text: '/start' } } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.ended, true);
});
