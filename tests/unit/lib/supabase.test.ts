import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLocalSessionUser, initLocalState, isLocalStorageReady } from '../../../src/lib/supabase';

test('local state helpers return default placeholders', () => {
  assert.equal(initLocalState(), false);
  assert.equal(isLocalStorageReady(), false);
  assert.equal(getLocalSessionUser(), null);
});
