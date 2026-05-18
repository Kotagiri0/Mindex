import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uuid } from '../../../src/lib/utils';

test('returns crypto uuid when available', () => {
  const originalCrypto = (globalThis as any).crypto;
  (globalThis as any).crypto = { randomUUID: () => 'test-uuid' };

  try {
    assert.equal(uuid(), 'test-uuid');
  } finally {
    (globalThis as any).crypto = originalCrypto;
  }
});

test('falls back to random template when crypto uuid missing', () => {
  const originalCrypto = (globalThis as any).crypto;
  const originalRandom = Math.random;
  (globalThis as any).crypto = undefined;
  Math.random = () => 0.1;

  try {
    const value = uuid();
    assert.match(value, /^[0-9a-f-]{36}$/i);
    assert.equal(value[14], '4');
  } finally {
    (globalThis as any).crypto = originalCrypto;
    Math.random = originalRandom;
  }
});
