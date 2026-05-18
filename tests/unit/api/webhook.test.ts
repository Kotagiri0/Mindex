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
