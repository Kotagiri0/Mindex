import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uuid, safeParseToolArgs } from '../../../src/lib/utils';

test('returns crypto uuid when available', () => {
  const originalRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => 'test-uuid' as any;

  try {
    assert.equal(uuid(), 'test-uuid');
  } finally {
    globalThis.crypto.randomUUID = originalRandomUUID;
  }
});

test('falls back to random template when crypto uuid missing', () => {
  const originalRandomUUID = globalThis.crypto.randomUUID;
  const originalRandom = Math.random;
  (globalThis.crypto as any).randomUUID = undefined;
  Math.random = () => 0.1;

  try {
    const value = uuid();
    assert.match(value, /^[0-9a-f-]{36}$/i);
    assert.equal(value[14], '4');
  } finally {
    globalThis.crypto.randomUUID = originalRandomUUID;
    Math.random = originalRandom;
  }
});

// safeParseToolArgs — защита от обрыва ответа модели на max_tokens (см.
// server.ts): JSON аргумента последнего tool_call режется посреди строки,
// раньше это ронял необработанным исключением весь цикл обработки хода
// в AIChat.tsx/DesktopApp.tsx.
test('safeParseToolArgs: валидный JSON — ok:true с разобранными args', () => {
  const result = safeParseToolArgs('{"name":"Позвонить маме","time":"15:00"}');
  assert.deepEqual(result, { ok: true, args: { name: 'Позвонить маме', time: '15:00' } });
});

test('safeParseToolArgs: оборванная строка (max_tokens) — ok:false, не бросает исключение', () => {
  // Ровно тот случай из прод-бага: JSON.parse на этом даёт
  // "Unterminated string in JSON at position 88".
  const truncated = '{"name":"работа над приложением","date":"2026-08-';
  const result = safeParseToolArgs(truncated);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof Error);
  }
});

test('safeParseToolArgs: пустая строка — ok:false', () => {
  const result = safeParseToolArgs('');
  assert.equal(result.ok, false);
});

test('safeParseToolArgs: не-JSON текст — ok:false', () => {
  const result = safeParseToolArgs('не json вообще');
  assert.equal(result.ok, false);
});
