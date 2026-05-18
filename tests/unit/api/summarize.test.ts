import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/summarize';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns 400 when messages missing', async () => {
  process.env.GROQ_API_KEY = 'key';
  const req = createMockReq({ method: 'POST', body: {} });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
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

test('returns 500 when api key missing', async () => {
  delete process.env.GROQ_API_KEY;
  const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
});

test('returns summary when Groq succeeds', async () => {
  process.env.GROQ_API_KEY = 'key';
  const originalClient = (globalThis as any).__GROQ_CLIENT__;
  (globalThis as any).__GROQ_CLIENT__ = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: 'summary' } }] }),
      },
    },
  };

  try {
    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary, 'summary');
  } finally {
    (globalThis as any).__GROQ_CLIENT__ = originalClient;
  }
});
