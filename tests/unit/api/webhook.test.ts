import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/webhook';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('ends early when configuration missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;

  const req = createMockReq({ method: 'POST', body: { message: { text: 'hi' } } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.ended, true);
});

test('handles OPTIONS preflight', async () => {
  const req = createMockReq({ method: 'OPTIONS' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
});

test('rejects non-post methods', async () => {
  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('ends early when message missing', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.VITE_SUPABASE_URL = 'url';
  process.env.VITE_SUPABASE_ANON_KEY = 'key';

  const req = createMockReq({ method: 'POST', body: {} });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
});
