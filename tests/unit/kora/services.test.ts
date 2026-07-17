import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ServiceExecutor,
  serviceListTool,
  serviceCallTool,
  isWriteServiceAction,
  type ServiceManifest,
} from '../../../src/kora/services.ts';

const TELEGRAM: ServiceManifest = {
  name: 'telegram',
  description: 'Telegram Bot API',
  base_url: 'https://api.telegram.org/bot{token}',
  auth: { type: 'token_in_url', credential: 'telegram_bot_token' },
  actions: {
    send_message: {
      method: 'POST',
      path: '/sendMessage',
      required: ['chat_id', 'text'],
      optional: ['parse_mode'],
      write: true,
      description: 'Отправить сообщение',
    },
    get_me: {
      method: 'GET',
      path: '/getMe',
      required: [],
      optional: [],
      write: false,
      description: 'Проверить бота',
    },
  },
};

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: string }) {
  return (async (url: string | URL, init: RequestInit = {}) => {
    const r = handler(String(url), init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
    } as unknown as Response;
  }) as typeof fetch;
}

// ТЗ раздел 6, правило: только объявленные поля уходят в запрос.
test('services.call: только объявленные (required+optional) поля уходят в HTTP-запрос', async () => {
  let capturedBody: any = null;
  const fetchImpl = mockFetch((url, init) => {
    capturedBody = JSON.parse(String(init.body));
    return { status: 200, body: JSON.stringify({ ok: true }) };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret-token', fetchImpl);
  await executor.call('telegram', 'send_message', {
    chat_id: 42,
    text: 'привет',
    extra_field_from_model: 'should not leak',
  });
  assert.deepEqual(capturedBody, { chat_id: 42, text: 'привет' });
});

test('services.call: неизвестное действие → ошибка ДО HTTP', async () => {
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return { status: 200, body: '{}' };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'nonexistent_action', {});
  assert.ok(result.error);
  assert.equal(called, false);
});

test('services.call: enum-нарушение → ошибка ДО HTTP', async () => {
  const manifestWithEnum: ServiceManifest = {
    ...TELEGRAM,
    actions: {
      ...TELEGRAM.actions,
      send_message: {
        ...TELEGRAM.actions.send_message,
        params: { parse_mode: { type: 'string', enum: ['HTML', 'Markdown'] } },
      },
    },
  };
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return { status: 200, body: '{}' };
  });
  const executor = new ServiceExecutor([manifestWithEnum], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'send_message', {
    chat_id: 1,
    text: 'x',
    parse_mode: 'BadFormat',
  });
  assert.ok(result.error);
  assert.equal(called, false);
});

// ТЗ раздел 6: write без idempotency-ключа НЕ ретраить никогда — письмо уедет
// дважды. Мок падает с 500 один раз; проверяем, что вызов ровно один.
test('services.call: write-действие НЕ ретраится при 500 (ровно 1 вызов)', async () => {
  let callCount = 0;
  const fetchImpl = mockFetch(() => {
    callCount++;
    return { status: 500, body: 'internal error' };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'send_message', { chat_id: 1, text: 'x' });
  assert.ok(result.error);
  assert.equal(callCount, 1);
});

test('services.call: read-действие ретраится на 5xx (2 вызова)', async () => {
  let callCount = 0;
  const fetchImpl = mockFetch(() => {
    callCount++;
    return { status: 503, body: 'temporarily unavailable' };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'get_me', {});
  assert.ok(result.error);
  assert.equal(callCount, 2);
});

// ТЗ раздел 6: секрет вычищается из ЛЮБОЙ ошибки — сетевые исключения иногда
// вшивают URL целиком, включая токен из token_in_url-авторизации.
test('services.call: токен в URL не утекает в текст ошибки (заменён на •••)', async () => {
  const fetchImpl = (async (url: string | URL) => {
    throw new Error(`ECONNRESET fetching ${String(url)}`);
  }) as typeof fetch;
  const executor = new ServiceExecutor([TELEGRAM], async () => 'super-secret-token', fetchImpl);
  const result = await executor.call('telegram', 'get_me', {});
  assert.ok(result.error);
  const errText = String(result.error);
  assert.ok(!errText.includes('super-secret-token'));
  assert.ok(errText.includes('•••'));
});

test('services.call: тело ошибки усечено до ~500 символов', async () => {
  const hugeBody = 'x'.repeat(5000);
  const fetchImpl = mockFetch(() => ({ status: 400, body: hugeBody }));
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'get_me', {});
  assert.ok(result.error);
  assert.ok(String(result.error).length <= 600);
});

test('services.call: нехватка обязательного поля → ошибка ДО HTTP', async () => {
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return { status: 200, body: '{}' };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);
  const result = await executor.call('telegram', 'send_message', { chat_id: 1 });
  assert.ok(result.error);
  assert.equal(called, false);
});

test('services.call: отсутствующий креденшел → честная ошибка, без HTTP', async () => {
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return { status: 200, body: '{}' };
  });
  const executor = new ServiceExecutor([TELEGRAM], async () => null, fetchImpl);
  const result = await executor.call('telegram', 'get_me', {});
  assert.ok(result.error);
  assert.equal(called, false);
});

test('ServiceExecutor.list: каталог без секретов и без полной params-схемы', () => {
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret');
  const list = executor.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].service, 'telegram');
  assert.ok(!JSON.stringify(list).includes('token_in_url'));
  assert.ok(!JSON.stringify(list).includes('base_url'));
});

test('isWriteServiceAction: определяет write динамически по service+action из args', () => {
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret');
  assert.equal(isWriteServiceAction(executor, { service: 'telegram', action: 'send_message' }), true);
  assert.equal(isWriteServiceAction(executor, { service: 'telegram', action: 'get_me' }), false);
});

test('serviceListTool / serviceCallTool: фабрики создают корректные ToolDef', async () => {
  const fetchImpl = mockFetch(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  const executor = new ServiceExecutor([TELEGRAM], async () => 'secret', fetchImpl);

  const listTool = serviceListTool(executor);
  assert.equal(listTool.name, 'сервис.list');
  assert.equal(listTool.isWrite, false);

  const callTool = serviceCallTool(executor);
  assert.equal(callTool.name, 'сервис.call');
  assert.equal(callTool.isWrite, true); // статичный безопасный дефолт
  const result: any = await callTool.execute(
    { service: 'telegram', action: 'get_me', args: {} },
    {},
  );
  assert.deepEqual(result, { ok: true });
});
