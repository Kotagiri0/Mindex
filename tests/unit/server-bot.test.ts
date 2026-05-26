import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { registerBotRoutes, startBot } from '../../server-bot';

test('registerBotRoutes skips registration without token', () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  process.env.ROUTERAI_API_KEY = 'key';

  let called = false;
  const app = { post: () => { called = true; } } as unknown as Express;
  registerBotRoutes(app, {} as Pool);
  assert.equal(called, false);
});

test('registerBotRoutes registers webhook route when configured', () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.ROUTERAI_API_KEY = 'key';

  let registeredPath = '';
  const app = {
    post: (path: string) => {
      registeredPath = path;
    },
  } as unknown as Express;

  registerBotRoutes(app, {} as Pool);
  assert.equal(registeredPath, '/api/telegram');
});

test('startBot exits when configuration missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.ROUTERAI_API_KEY;
  await startBot({} as Pool);
  assert.ok(true);
});
