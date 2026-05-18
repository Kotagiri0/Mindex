import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/db-status';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns configured false when env missing', () => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;

  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  handler(req, res);

  assert.equal(res.body.configured, false);
});

test('handles OPTIONS preflight', () => {
  const req = createMockReq({ method: 'OPTIONS' });
  const res = createMockRes();
  handler(req, res);
  assert.equal(res.statusCode, 200);
});
