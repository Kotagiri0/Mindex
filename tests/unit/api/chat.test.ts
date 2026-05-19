import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../../../api/chat';
import { createMockReq, createMockRes } from '../../helpers/vercel';
import { jsonResponse, textResponse } from '../../helpers/response';

test('returns health check on GET', async () => {
  const req = createMockReq({ method: 'GET', headers: { 'user-agent': 'test' } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
});

test('returns error when api key missing', async () => {
  delete process.env.ROUTERAI_API_KEY;
  const req = createMockReq({ method: 'POST', body: { messages: [] } });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
});

test('returns message when RouterAI responds', async () => {
  process.env.ROUTERAI_API_KEY = 'key';
  (globalThis as any).fetch = async () =>
    jsonResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });

  const req = createMockReq({
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hi' }], systemInstruction: 'sys' },
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.content, 'ok');
});

test('returns error when RouterAI fails', async () => {
  process.env.ROUTERAI_API_KEY = 'key';
  (globalThis as any).fetch = async () =>
    textResponse('bad', { status: 500, statusText: 'Error' });

  const req = createMockReq({
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hi' }], systemInstruction: 'sys' },
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
});
