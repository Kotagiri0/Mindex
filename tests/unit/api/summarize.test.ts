import assert from 'node:assert/strict';
import { test } from 'node:test';
import Groq from 'groq-sdk';
import handler from '../../../api/summarize';
import { createMockReq, createMockRes } from '../../helpers/vercel';

test('returns 400 when messages missing', async () => {
  process.env.GROQ_API_KEY = 'key';
  const req = createMockReq({ method: 'POST', body: {} });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
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
  const originalChat = (Groq as any).prototype.chat;
  (Groq as any).prototype.chat = {
    completions: {
      create: async () => ({ choices: [{ message: { content: 'summary' } }] }),
    },
  };

  try {
    const req = createMockReq({ method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary, 'summary');
  } finally {
    (Groq as any).prototype.chat = originalChat;
  }
});
