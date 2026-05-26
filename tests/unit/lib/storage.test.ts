import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { storage } from '../../../src/lib/storage';
import { installLocalStorage } from '../../helpers/local-storage';

beforeEach(() => {
  installLocalStorage();
});

test('stores and retrieves current user', () => {
  storage.setCurrentUser({ id: 'u1', username: 'demo', displayName: 'Demo', createdAt: 1 });
  assert.equal(storage.getCurrentUser()?.id, 'u1');
});

test('falls back to legacy session user when current user is missing', () => {
  storage.setUsers([{ id: 'legacy', username: 'legacy', displayName: 'Legacy', createdAt: 10 }]);
  storage.setSessionUserId('legacy');
  assert.equal(storage.getCurrentUser()?.id, 'legacy');
});

test('migrates legacy tasks when per-user storage missing', () => {
  localStorage.setItem('mx_tasks', JSON.stringify([{ id: 't1', name: 'legacy', time: '', date: '2026-05-18', done: false }]));
  const tasks = storage.getTasks('user-1');
  assert.equal(tasks.length, 1);
  assert.equal(localStorage.getItem('mx_tasks_user-1') !== null, true);
});

test('returns default profile when none stored', () => {
  const profile = storage.getProfile('user-2');
  assert.equal(profile.onboarding_complete, false);
  assert.equal(profile.settings.agent, true);
});

test('getDefaultSettings returns baseline settings', () => {
  const settings = storage.getDefaultSettings();
  assert.equal(settings.agent, true);
  assert.equal(settings.confirm, true);
  assert.equal(settings.notifs, true);
});
