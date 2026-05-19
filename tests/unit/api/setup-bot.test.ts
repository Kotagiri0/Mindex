import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import handler from '../../../api/setup-bot';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns error when token missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  const req = createMockReq({ method: 'GET', headers: { host: 'example.com' } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('sets webhook when token present', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  const originalGet = axios.get;
  const calls: string[] = [];
  axios.get = async (url: string) => {
    calls.push(url);
    return { data: { result: { url: 'hook' } } } as any;
  };

  try {
    const req = createMockReq({ method: 'GET', headers: { host: 'example.com', 'x-forwarded-proto': 'https' } });
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(calls.length, 2);
  } finally {
    axios.get = originalGet;
  }
});
