import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { db } from '../../../src/lib/db';
import { storage } from '../../../src/lib/storage';
import type { Task, Thread } from '../../../src/types';
import { installDomStubs } from '../../helpers/dom';
import { jsonResponse } from '../../helpers/response';

const createUser = () => ({
  id: 'user-1',
  username: 'demo',
  displayName: 'Demo',
  createdAt: Date.now(),
});

beforeEach(() => {
  installDomStubs();
});

test('returns default profile when user is missing', async () => {
  const profile = await db.getProfile();
  assert.equal(profile.onboarding_complete, false);
});

test('getUserId returns current user id', () => {
  storage.setCurrentUser(createUser());
  assert.equal(db.getUserId(), 'user-1');
});

test('getTasks returns empty list when user not set', async () => {
  const tasks = await db.getTasks();
  assert.deepEqual(tasks, []);
});

test('getThreads merges pending local threads with server threads', async () => {
  storage.setCurrentUser(createUser());
  storage.setThreads('user-1', [
    { id: 'local', title: 'Local', preview: '', messages: [], createdAt: 1 },
  ]);

  (globalThis as any).fetch = async () =>
    jsonResponse({
      profile: null,
      tasks: [],
      threads: [
        { id: 'server', title: 'Server', preview: '', messages: [], createdAt: 2 },
      ],
    });

  const threads = await db.getThreads();
  assert.equal(threads.length, 2);
  assert.equal(threads[0].id, 'local');
});

test('saveThread persists locally even if server fails', async () => {
  storage.setCurrentUser(createUser());
  (globalThis as any).fetch = async () => {
    throw new Error('offline');
  };

  const thread: Thread = { id: 't1', title: 'Title', preview: '', messages: [], createdAt: 1 };
  await db.saveThread(thread);
  const stored = storage.getThreads('user-1');
  assert.equal(stored.length, 1);
});

test('saveThread handles concurrent saves', async () => {
  storage.setCurrentUser(createUser());
  (globalThis as any).fetch = async () => jsonResponse({ success: true });

  await Promise.all([
    db.saveThread({ id: 't1', title: 'A', preview: '', messages: [], createdAt: 1 }),
    db.saveThread({ id: 't2', title: 'B', preview: '', messages: [], createdAt: 2 }),
  ]);

  const stored = storage.getThreads('user-1');
  const ids = stored.map((t) => t.id).sort();
  assert.deepEqual(ids, ['t1', 't2']);
});

test('upsertProfile stores locally and posts to API', async () => {
  storage.setCurrentUser(createUser());
  let called = false;
  (globalThis as any).fetch = async () => {
    called = true;
    return jsonResponse({ success: true });
  };

  await db.upsertProfile(true, { agent: true, confirm: true, notifs: true });
  const profile = storage.getProfile('user-1');
  assert.equal(profile.onboarding_complete, true);
  assert.equal(called, true);
});

test('archiveThread exits when user missing', async () => {
  let called = false;
  (globalThis as any).fetch = async () => {
    called = true;
    return jsonResponse({ success: true });
  };

  await db.archiveThread('thread-1');
  assert.equal(called, false);
});

test('deleteThread removes local data', async () => {
  storage.setCurrentUser(createUser());
  storage.setThreads('user-1', [
    { id: 'thread-1', title: 'Thread', preview: '', messages: [], createdAt: 1 },
  ]);
  (globalThis as any).fetch = async () => jsonResponse({ success: true });

  await db.deleteThread('thread-1');
  const stored = storage.getThreads('user-1');
  assert.equal(stored.length, 0);
});

test('deleteTask removes local data', async () => {
  storage.setCurrentUser(createUser());
  storage.setTasks('user-1', [
    { id: 'task-1', name: 'Task', date: '2026-05-18', time: '', done: false },
  ]);
  (globalThis as any).fetch = async () => jsonResponse({ success: true });

  await db.deleteTask('task-1');
  const stored = storage.getTasks('user-1');
  assert.equal(stored.length, 0);
});

test('saveTask persists locally and calls API', async () => {
  storage.setCurrentUser(createUser());
  let called = false;
  (globalThis as any).fetch = async () => {
    called = true;
    return jsonResponse({ success: true });
  };

  const task: Task = { id: 'task-1', name: 'Task', date: '2026-05-18', time: '', done: false };
  await db.saveTask(task, { skipCalendarSync: true });

  assert.equal(called, true);
  const stored = storage.getTasks('user-1');
  assert.equal(stored[0].id, 'task-1');
});

test('refreshTasks falls back to local storage on fetch error', async () => {
  storage.setCurrentUser(createUser());
  storage.setTasks('user-1', [{ id: 'task-1', name: 'Task', date: '2026-05-18', time: '', done: false }]);
  (globalThis as any).fetch = async () => {
    throw new Error('fail');
  };

  const tasks = await db.refreshTasks();
  assert.equal(tasks.length, 1);
});
