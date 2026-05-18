import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { apiFetch, getCurrentUser, getSessionToken, loginGoogleUser, loginLocalUser, logoutLocalUser, registerLocalUser } from '../../../src/lib/auth';
import { installDomStubs } from '../../helpers/dom';
import { jsonResponse } from '../../helpers/response';

beforeEach(() => {
  installDomStubs();
});

test('rejects registration with missing credentials', async () => {
  await assert.rejects(() => registerLocalUser({ username: '', password: '' }), /Укажи имя пользователя/);
});

test('rejects registration with short username', async () => {
  await assert.rejects(() => registerLocalUser({ username: 'ab', password: '1234' }), /не короче 3/);
});

test('rejects registration with short password', async () => {
  await assert.rejects(() => registerLocalUser({ username: 'demo', password: '123' }), /не короче 4/);
});

test('registers local user and stores session', async () => {
  const fetchCalls: any[] = [];
  (globalThis as any).fetch = async (url: string, options: any) => {
    fetchCalls.push({ url, options });
    return jsonResponse({
      user: { id: 'u1', username: 'demo', displayName: 'Demo', createdAt: 1, provider: 'local' },
      token: 'token-1',
    });
  };

  const user = await registerLocalUser({ username: 'demo', password: '1234', displayName: 'Demo' });
  assert.equal(user.id, 'u1');
  assert.equal(getCurrentUser()?.id, 'u1');
  assert.equal(localStorage.getItem('mx_session_token'), 'token-1');
  assert.equal(fetchCalls.length, 1);
});

test('logs in local user and stores token', async () => {
  (globalThis as any).fetch = async () =>
    jsonResponse({
      user: { id: 'u2', username: 'demo', displayName: 'Demo', createdAt: 1, provider: 'local' },
      token: 'token-2',
    });

  const user = await loginLocalUser({ username: 'Demo', password: 'pass' });
  assert.equal(user.id, 'u2');
  assert.equal(localStorage.getItem('mx_session_token'), 'token-2');
});

test('logs in Google user and stores session', async () => {
  (globalThis as any).fetch = async () =>
    jsonResponse({
      user: { id: 'u3', username: 'google', displayName: 'Google', createdAt: 1, provider: 'google' },
      token: 'token-3',
    });

  const user = await loginGoogleUser('cred');
  assert.equal(user.id, 'u3');
  assert.equal(localStorage.getItem('mx_session_token'), 'token-3');
});

test('apiFetch attaches authorization header when session token exists', async () => {
  localStorage.setItem('mx_session_token', 'token-abc');
  let receivedHeaders: any = {};
  (globalThis as any).fetch = async (_url: string, options: any) => {
    receivedHeaders = options.headers;
    return jsonResponse({ ok: true });
  };

  await apiFetch('/api/test');
  assert.equal(receivedHeaders.Authorization, 'Bearer token-abc');
});

test('getSessionToken returns stored token', () => {
  localStorage.setItem('mx_session_token', 'token-xyz');
  assert.equal(getSessionToken(), 'token-xyz');
});

test('logout clears session data', () => {
  localStorage.setItem('mx_session_token', 'token');
  localStorage.setItem('mx_current_user', JSON.stringify({ id: 'u' }));
  localStorage.setItem('mx_session_user_id', 'u');
  logoutLocalUser();
  assert.equal(localStorage.getItem('mx_session_token'), null);
  assert.equal(localStorage.getItem('mx_current_user'), null);
  assert.equal(localStorage.getItem('mx_session_user_id'), null);
});
