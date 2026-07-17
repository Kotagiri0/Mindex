import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Express } from 'express';
import type { Pool } from 'pg';
import {
  registerBotRoutes,
  startBot,
  getConfirmSetting,
  queueConfirmation,
  resolvePendingAction,
} from '../../server-bot';

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

// ─── HITL-гейт (docs/PORTING_TO_TS.md, раздел 5) ───────────────────────────

type Queried = { sql: string; params: any[] };

function makeDb(rowsFor: (sql: string) => any[]): { db: Pool; queries: Queried[] } {
  const queries: Queried[] = [];
  const db = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      return { rows: rowsFor(sql) };
    },
  } as unknown as Pool;
  return { db, queries };
}

function mockFetch() {
  const calls: { url: string; body: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return { json: async () => ({ ok: true, result: { message_id: 1 } }) } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const fakeCq = (overrides: Partial<any> = {}) => ({
  id: 'cq1',
  from: { id: 1, first_name: 'T' },
  message: { chat: { id: 1 }, message_id: 1 },
  ...overrides,
});

test('getConfirmSetting: явный false в settings отключает гейт', async () => {
  const { db } = makeDb(() => [{ confirm: false }]);
  assert.equal(await getConfirmSetting(db, 'tg_1'), false);
});

test('getConfirmSetting: без строки настроек дефолт — true (безопасный дефолт)', async () => {
  const { db } = makeDb(() => []);
  assert.equal(await getConfirmSetting(db, 'tg_1'), true);
});

test('queueConfirmation: создаёт один pending на несколько write-вызовов и не исполняет их', async () => {
  const { db, queries } = makeDb((sql) => {
    if (sql.includes('SELECT name, date, time FROM user_tasks')) {
      return [{ name: 'Задача А', date: '2026-07-16', time: '10:00' }];
    }
    return [];
  });
  const { calls, restore } = mockFetch();
  try {
    const toolCalls = [
      { function: { name: 'delete_task', arguments: JSON.stringify({ id: 'a' }) } },
      { function: { name: 'delete_task', arguments: JSON.stringify({ id: 'b' }) } },
    ];
    await queueConfirmation(db, 'tg_1', 'thread1', 'tok', 1, toolCalls);

    const inserts = queries.filter(q => q.sql.includes('INSERT INTO pending_actions'));
    assert.equal(inserts.length, 1, 'один pending на весь шаг, не по одному на вызов');

    const deletes = queries.filter(q => q.sql.includes('DELETE FROM user_tasks'));
    assert.equal(deletes.length, 0, 'delete_task не должен исполняться до подтверждения');

    const sendMessage = calls.find(c => c.url.includes('/sendMessage'));
    assert.ok(sendMessage, 'должно уйти сообщение с кнопками подтверждения');
    assert.ok(sendMessage!.body.reply_markup?.inline_keyboard, 'сообщение должно содержать inline-кнопки');
  } finally {
    restore();
  }
});

test('resolvePendingAction: просроченный/несуществующий pending не исполняется', async () => {
  const { db, queries } = makeDb(() => []); // SELECT pending → пусто, т.к. истёк/не найден
  const { calls, restore } = mockFetch();
  try {
    await resolvePendingAction('missing-id', 'confirmed', 'tok', db, fakeCq());

    const answer = calls.find(c => c.url.includes('/answerCallbackQuery'));
    assert.ok(answer?.body.text?.includes('устарело'));

    const confirmedUpdates = queries.filter(q =>
      q.sql.includes('UPDATE pending_actions') && q.params.includes('confirmed')
    );
    assert.equal(confirmedUpdates.length, 0, 'нельзя подтвердить то, чего уже нет в pending');
  } finally {
    restore();
  }
});
