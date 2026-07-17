// Тесты HITL-гейта write-действий (раздел 5 ТЗ, Фаза 5). Каждый тест
// закрывает один из 8 пунктов механики раздела — см. docs/PORTING_TO_TS.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryPendingStore,
  InMemoryGateAuditLog,
  resolveUserReply,
  isExpired,
  renderConfirmQuestion,
  describeAction,
  evaluatePermission,
  splitWriteActions,
  queuePending,
  confirmPending,
  rejectPending,
  PENDING_TTL_MS,
  type PendingAction,
  type QueuedWriteAction,
} from '../../../src/kora/hitl.ts';
import { ToolRegistry, type ToolDef } from '../../../src/kora/registry.ts';
import { runReactLoop, type ChatMessage } from '../../../src/kora/loop.ts';

// ─── фикстуры общие с loop.test.ts ─────────────────────────────────────

function scriptedGenerate(responses: string[]) {
  const calls: ChatMessage[][] = [];
  let i = 0;
  const fn = async (messages: ChatMessage[]) => {
    calls.push(messages.map((m) => ({ ...m })));
    if (i >= responses.length) {
      throw new Error(`scriptedGenerate: запрошен ответ №${i + 1}, но заготовлено только ${responses.length}`);
    }
    return responses[i++];
  };
  return { fn, calls, callCount: () => calls.length };
}

function searchTool(execute: ToolDef['execute']): ToolDef {
  return {
    name: 'рельса.search',
    description: 'поиск в вебе',
    argsSchema: { query: { type: 'string', required: true, description: 'запрос', maxLen: 300 } },
    isWrite: false,
    execute,
  };
}

function sendTool(execute: ToolDef['execute']): ToolDef {
  return {
    name: 'сервис.send_message',
    description: 'отправить сообщение вовне',
    argsSchema: {
      chat: { type: 'string', required: true, description: 'адресат' },
      text: { type: 'string', required: true, description: 'текст' },
    },
    isWrite: true,
    execute,
  };
}

// ─── п.1/п.2 — write не исполняется, попадает в pending, byte-in-byte payload ──

test('hitl: write-действие не исполняется сразу, уходит в pending; вопрос содержит точный JSON payload', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(sendTool(async (args) => {
    executed = true;
    return { ok: true, args };
  }));

  const gen = scriptedGenerate([
    '<action tool="сервис.send_message">{"chat": "@ivan", "text": "привет"}</action>',
  ]);

  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();

  const res = await runReactLoop({
    userMsg: 'напиши ивану привет',
    registry,
    ctx: {},
    generate: gen.fn,
    hitl: { store, audit, userId: 'u1', threadId: 't1' },
  });

  assert.equal(executed, false, 'write не должен исполниться до подтверждения');
  assert.equal(res.stopReason, 'confirm_required');
  // byte-in-byte: точный JSON args должен быть в вопросе как есть
  assert.ok(res.answer.includes(JSON.stringify({ chat: '@ivan', text: 'привет' })));

  const pending = await store.getActive('u1', 't1');
  assert.ok(pending);
  assert.equal(pending!.actions.length, 1);
  assert.equal(pending!.actions[0].tool, 'сервис.send_message');
});

// ─── п.1 — изоляция по threadId ────────────────────────────────────────

test('hitl: pending привязан к (userId, threadId) — другой threadId не находит его', async () => {
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();
  await queuePending(
    store,
    audit,
    'u1',
    'thread-A',
    [{ tool: 'сервис.send_message', args: { chat: '@x' }, describe: 'сервис.send_message {"chat":"@x"}' }],
    Date.now()
  );

  const foundSame = await store.getActive('u1', 'thread-A');
  const foundOther = await store.getActive('u1', 'thread-B');
  assert.ok(foundSame);
  assert.equal(foundOther, null);
});

// ─── п.3 — несколько write в одном шаге → один pending ─────────────────

test('hitl: два write-действия одного шага собираются в ОДИН pending с одним вопросом', async () => {
  const registry = new ToolRegistry();
  registry.register(sendTool(async () => ({ ok: true })));
  registry.register({
    name: 'сервис.create_event',
    description: 'создать событие',
    argsSchema: { title: { type: 'string', required: true, description: 'заголовок' } },
    isWrite: true,
    execute: async () => ({ ok: true }),
  });

  const gen = scriptedGenerate([
    '<action tool="сервис.send_message">{"chat": "@ivan", "text": "привет"}</action>' +
      '<action tool="сервис.create_event">{"title": "встреча"}</action>',
  ]);

  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();

  const res = await runReactLoop({
    userMsg: 'напиши ивану и создай встречу',
    registry,
    ctx: {},
    generate: gen.fn,
    hitl: { store, audit, userId: 'u1', threadId: 't1' },
  });

  assert.equal(res.stopReason, 'confirm_required');
  const pending = await store.getActive('u1', 't1');
  assert.equal(pending!.actions.length, 2, 'оба write-действия должны попасть в один pending');
  // один вопрос — считаем ответы гейта в trace (не два отдельных blocked-финала)
  const finals = res.steps.filter((s) => s.type === 'final');
  assert.equal(finals.length, 1);
});

// ─── п.4 — write + read в одном шаге: read исполнен, результат не потерян ──

test('hitl: write вперемешку с read — read исполнен (execute вызван), write в pending', async () => {
  let searchExecuted = false;
  const registry = new ToolRegistry();
  registry.register(searchTool(async (args) => {
    searchExecuted = true;
    return { query: args.query, results: [{ title: 'ok', url: 'https://real.example/x' }] };
  }));
  registry.register(sendTool(async () => ({ ok: true })));

  // ВАЖНО: в write-payload нет URL — URL из результата поиска этого же шага
  // ещё не существует в evidence на момент пре-пасса, и G6 правомерно
  // заблокировал бы его как фабрикацию (модель не могла его видеть).
  const gen = scriptedGenerate([
    '<action tool="рельса.search">{"query": "новости"}</action>' +
      '<action tool="сервис.send_message">{"chat": "@ivan", "text": "нашёл новости, пришлю сводку"}</action>',
  ]);

  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();

  const res = await runReactLoop({
    userMsg: 'найди новости и отправь ивану',
    registry,
    ctx: {},
    generate: gen.fn,
    hitl: { store, audit, userId: 'u1', threadId: 't1' },
  });

  assert.equal(searchExecuted, true, 'read-действие должно быть исполнено, несмотря на гейт write');
  assert.equal(res.stopReason, 'confirm_required');
  const pending = await store.getActive('u1', 't1');
  assert.equal(pending!.actions.length, 1);
  assert.equal(pending!.actions[0].tool, 'сервис.send_message');
});

// ─── п.5 — resolveUserReply ─────────────────────────────────────────────

test('hitl: resolveUserReply — да/подтверждаю → confirm, нет/отмена → reject, остальное → other', () => {
  for (const yes of ['да', 'Давай', 'подтверждаю', 'ОК', 'ок!', 'yes', 'го']) {
    assert.equal(resolveUserReply(yes), 'confirm', `ожидал confirm для "${yes}"`);
  }
  for (const no of ['нет', 'Отмена', 'стоп', 'no', 'cancel']) {
    assert.equal(resolveUserReply(no), 'reject', `ожидал reject для "${no}"`);
  }
  for (const other of ['а какая погода?', 'да, но подожди', 'напиши другое сообщение', '']) {
    assert.equal(resolveUserReply(other), 'other', `ожидал other для "${other}"`);
  }
});

// ─── п.6 — TTL ───────────────────────────────────────────────────────────

test('hitl: pending старше 15 минут — expired, удалён из store, аудит "expired"', async () => {
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();
  const createdAt = Date.now() - (PENDING_TTL_MS + 1000);
  const pending: PendingAction = {
    id: 'p1',
    userId: 'u1',
    threadId: 't1',
    createdAt,
    actions: [{ tool: 'сервис.send_message', args: {}, describe: 'x' }],
  };
  await store.put(pending);

  assert.ok(isExpired(pending, Date.now()));

  const result = await confirmPending(store, audit, 'u1', 't1', Date.now());
  assert.equal(result, null, 'протухший pending не должен подтверждаться');
  assert.equal(await store.getActive('u1', 't1'), null, 'протухший pending должен быть удалён');
  assert.ok(audit.events.some((e) => e.kind === 'expired'));
});

// ─── п.7 — permissions: deny → allow → ask ──────────────────────────────

test('hitl: permissions — deny сильнее широкого allow', () => {
  const rules = { allow: ['сервис:*'], deny: ['сервис:send_message'] };
  assert.equal(evaluatePermission(rules, 'сервис', 'send_message', {}), 'deny');
  assert.equal(evaluatePermission(rules, 'сервис', 'create_event', {}), 'allow');
});

test('hitl: permissions — allow со скоупом по аргументу пропускает только совпадающее значение', () => {
  const rules = { allow: ['сервис:send_message(chat=@ivan)'] };
  assert.equal(evaluatePermission(rules, 'сервис', 'send_message', { chat: '@ivan' }), 'allow');
  assert.equal(evaluatePermission(rules, 'сервис', 'send_message', { chat: '@petr' }), 'ask');
});

test('hitl: permissions — без правил вообще всё уходит в ask', () => {
  assert.equal(evaluatePermission(undefined, 'сервис', 'send_message', {}), 'ask');
  assert.equal(evaluatePermission({}, 'сервис', 'send_message', {}), 'ask');
});

// ─── интеграция в петлю: allow исполняет без вопроса, deny блокирует ────

test('hitl: allow-правило исполняет write без вопроса подтверждения', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(sendTool(async (args) => {
    executed = true;
    return { ok: true, args };
  }));
  const gen = scriptedGenerate([
    '<action tool="сервис.send_message">{"chat": "@ivan", "text": "привет"}</action>',
    '<answer>Готово, отправил.</answer>',
  ]);
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();

  const res = await runReactLoop({
    userMsg: 'напиши ивану привет',
    registry,
    ctx: {},
    generate: gen.fn,
    hitl: {
      store,
      audit,
      userId: 'u1',
      threadId: 't1',
      permissions: { allow: ['сервис:send_message(chat=@ivan)'] },
    },
  });

  assert.equal(executed, true);
  assert.notEqual(res.stopReason, 'confirm_required');
  assert.equal(await store.getActive('u1', 't1'), null);
  assert.ok(audit.events.some((e) => e.kind === 'auto_allowed'));
});

test('hitl: deny-правило блокирует write, не создаёт pending', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(sendTool(async (args) => {
    executed = true;
    return { ok: true, args };
  }));
  const gen = scriptedGenerate([
    '<action tool="сервис.send_message">{"chat": "@ivan", "text": "привет"}</action>',
    '<answer>Не смог отправить.</answer>',
  ]);
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();

  const res = await runReactLoop({
    userMsg: 'напиши ивану привет',
    registry,
    ctx: {},
    generate: gen.fn,
    hitl: {
      store,
      audit,
      userId: 'u1',
      threadId: 't1',
      permissions: { deny: ['сервис:send_message'] },
    },
  });

  assert.equal(executed, false);
  assert.notEqual(res.stopReason, 'confirm_required');
  assert.equal(await store.getActive('u1', 't1'), null);
  assert.ok(audit.events.some((e) => e.kind === 'denied_by_policy'));
});

// ─── п.8 — аудит: каждый исход оставляет запись ─────────────────────────

test('hitl: аудит-лог фиксирует queued/confirmed/rejected/expired', async () => {
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();
  const actions: QueuedWriteAction[] = [
    { tool: 'сервис.send_message', args: { chat: '@x' }, describe: 'x' },
  ];

  await queuePending(store, audit, 'u1', 't1', actions, Date.now());
  assert.ok(audit.events.some((e) => e.kind === 'queued'));

  const confirmed = await confirmPending(store, audit, 'u1', 't1', Date.now());
  assert.ok(confirmed);
  assert.ok(audit.events.some((e) => e.kind === 'confirmed'));

  await queuePending(store, audit, 'u1', 't2', actions, Date.now());
  const rejected = await rejectPending(store, audit, 'u1', 't2', Date.now());
  assert.ok(rejected);
  assert.ok(audit.events.some((e) => e.kind === 'rejected'));
});

// ─── describe / renderConfirmQuestion ───────────────────────────────────

test('hitl: describeAction сериализует args кодом (byte-in-byte), renderConfirmQuestion собирает вопрос', () => {
  const describe = describeAction('сервис.send_message', { chat: '@ivan', text: 'привет' });
  assert.ok(describe.includes(JSON.stringify({ chat: '@ivan', text: 'привет' })));

  const pending: PendingAction = {
    id: 'p1',
    userId: 'u1',
    threadId: 't1',
    createdAt: Date.now(),
    actions: [{ tool: 'сервис.send_message', args: {}, describe }],
  };
  const question = renderConfirmQuestion(pending);
  assert.ok(question.includes(describe));
  assert.ok(question.includes('Подтвердить?'));
});

// ─── splitWriteActions ───────────────────────────────────────────────────

test('hitl: splitWriteActions разбивает действия шага на write/read', () => {
  const actions = [
    { tool: 'рельса.search', args: {} },
    { tool: 'сервис.send_message', args: {} },
  ];
  const { writes, reads } = splitWriteActions(actions, (a) => a.tool === 'сервис.send_message');
  assert.equal(writes.length, 1);
  assert.equal(reads.length, 1);
  assert.equal(writes[0].tool, 'сервис.send_message');
});

// ─── обратная совместимость ──────────────────────────────────────────────

test('hitl: без опции hitl write-действие исполняется как обычное (обратная совместимость)', async () => {
  let executed = false;
  const registry = new ToolRegistry();
  registry.register(sendTool(async (args) => {
    executed = true;
    return { ok: true, args };
  }));
  const gen = scriptedGenerate([
    '<action tool="сервис.send_message">{"chat": "@ivan", "text": "привет"}</action>',
    '<answer>Готово.</answer>',
  ]);

  const res = await runReactLoop({
    userMsg: 'напиши ивану привет',
    registry,
    ctx: {},
    generate: gen.fn,
  });

  assert.equal(executed, true);
  assert.notEqual(res.stopReason, 'confirm_required');
});

// Ревью-регрессия (ТЗ §5 + G6): выдуманный URL в write-payload блокируется
// ДО постановки в очередь подтверждения — фабрикацию нельзя даже показывать
// в вопросе «подтвердить?».
test('hitl: write с выдуманным URL не попадает в pending — блок до очереди', async () => {
  const reg = new ToolRegistry();
  let executed = false;
  reg.register({
    name: 'сервис.call',
    description: 'вызов внешнего сервиса',
    argsSchema: {},
    isWrite: true,
    execute: async () => { executed = true; return { sent: true }; },
  });
  const store = new InMemoryPendingStore();
  const audit = new InMemoryGateAuditLog();
  const gen = scriptedGenerate([
    '<action tool="сервис.call">{"service":"tg","action":"send","args":{"text":"смотри https://fake-invented.example/xyz"}}</action>',
    '<answer>не отправил — ссылка не подтверждена</answer>',
  ]);

  const res = await runReactLoop({
    userMsg: 'отправь мне ссылку на статью',
    registry: reg,
    ctx: {},
    generate: gen.fn,
    hitl: { store, audit, userId: 'u1', threadId: 't1' },
  });

  assert.equal(await store.getActive('u1', 't1'), null); // в очередь НЕ попало
  assert.equal(executed, false);
  assert.notEqual(res.stopReason, 'confirm_required');
});
