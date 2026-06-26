import { LocalUser } from '../types';
import { storage } from './storage';

const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const getCurrentUser = (): LocalUser | null => {
  return storage.getCurrentUser();
};

export const getSessionToken = (): string | null => storage.getSessionToken();

export const apiFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = storage.getSessionToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> || {}),
    },
  });
};

const mapApiUser = (user: any): LocalUser => ({
  id: String(user.id),
  username: String(user.username),
  displayName: String(user.displayName),
  createdAt: Number(user.createdAt),
  provider: (user.provider === 'google' ? 'google' : user.provider === 'email' ? 'email' : 'local') as 'google' | 'local' | 'email',
  email: user.email ? String(user.email) : undefined,
  avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
});

export const registerLocalUser = async (input: { username: string; password: string; displayName?: string }) => {
  const username = normalizeUsername(input.username);
  const displayName = (input.displayName || input.username).trim();

  if (!username || !input.password) {
    throw new Error('Укажи имя пользователя и пароль.');
  }

  if (username.length < 3) {
    throw new Error('Имя пользователя должно быть не короче 3 символов.');
  }

  if (input.password.length < 4) {
    throw new Error('Пароль должен быть не короче 4 символов.');
  }

  const res = await fetch(`${window.location.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: input.password, displayName }),
  });
  const data = await res.json().catch(() => ({ error: 'Некорректный ответ сервера.' }));
  if (!res.ok) throw new Error(data.error || 'Ошибка авторизации.');

  const user = mapApiUser(data.user);
  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  if (data.token) storage.setSessionToken(data.token);
  return user;
};

export const loginLocalUser = async (input: { username: string; password: string }) => {
  const username = normalizeUsername(input.username);

  const res = await fetch(`${window.location.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: input.password }),
  });
  const data = await res.json().catch(() => ({ error: 'Некорректный ответ сервера.' }));
  if (!res.ok) throw new Error(data.error || 'Ошибка авторизации.');

  const user = mapApiUser(data.user);
  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  if (data.token) storage.setSessionToken(data.token);
  return user;
};

export const loginGoogleUser = async (credential: string) => {
  const response = await fetch(`${window.location.origin}/api/auth/google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential }),
  });

  const data = await response.json().catch(() => ({ error: 'Некорректный ответ сервера.' }));
  if (!response.ok) {
    throw new Error(data.error || 'Ошибка авторизации через Google.');
  }

  const user = mapApiUser(data.user);
  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  if (data.token) storage.setSessionToken(data.token);
  return user;
};

export const loginYandexUser = async (code: string, redirectUri?: string, consent?: boolean) => {
  const response = await fetch(`${window.location.origin}/api/auth/yandex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, redirectUri, consent: consent === true }),
  });

  const data = await response.json().catch(() => ({ error: 'Некорректный ответ сервера.' }));
  if (!response.ok) {
    throw new Error(data.error || 'Ошибка авторизации через Яндекс.');
  }

  const user = mapApiUser(data.user);
  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  if (data.token) storage.setSessionToken(data.token);
  return user;
};

export const logoutLocalUser = () => {
  storage.clearSessionUserId();
  storage.clearCurrentUser();
  storage.clearSessionToken();
};