import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/config';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns config payload for GET', () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'key';
  process.env.VITE_GOOGLE_CLIENT_ID = 'google-id';

  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.googleClientId, 'google-id');
});

test('handles OPTIONS preflight', () => {
  const req = createMockReq({ method: 'OPTIONS' });
  const res = createMockRes();
  handler(req, res);
  assert.equal(res.statusCode, 200);
});
