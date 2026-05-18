import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import handler from '../../../api/bot-status';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns configured false when token missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.body.configured, false);
});

test('returns configured true when telegram responds', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  const originalGet = axios.get;
  axios.get = async () => ({ data: { result: { url: 'hook' } } }) as any;

  try {
    const req = createMockReq({ method: 'GET' });
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.body.configured, true);
  } finally {
    axios.get = originalGet;
  }
});
