import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uuid } from '../../../src/lib/utils';

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
