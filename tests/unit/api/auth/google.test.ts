import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { createMockReq, createMockRes } from '../../../helpers/vercel';

process.env.DATABASE_URL = 'postgres://test';
process.env.GOOGLE_CLIENT_ID = 'client';

Pool.prototype.query = async () => ({ rows: [] }) as any;

const { default: handler } = await import('../../../../api/auth/google');

test('rejects non-post methods', async () => {
  const req = createMockReq({ method: 'GET' });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('rejects missing credential', async () => {
  const req = createMockReq({ method: 'POST', body: {} });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});
