import { LocalUser } from '../types';
import { storage } from './storage';

const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const getCurrentUser = (): LocalUser | null => {
  return storage.getCurrentUser();
};

const mapApiUser = (user: any): LocalUser => ({
  id: String(user.id),
  username: String(user.username),
  displayName: String(user.displayName),
  createdAt: Number(user.createdAt),
});

const authRequest = async (endpoint: 'register' | 'login', payload: { username: string; password: string; displayName?: string }) => {
  const response = await fetch(`${window.location.origin}/api/auth/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({ error: 'Некорректный ответ сервера.' }));
  if (!response.ok) {
    throw new Error(data.error || 'Ошибка авторизации.');
  }

  return mapApiUser(data.user);
};

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

  const user = await authRequest('register', {
    username,
    password: input.password,
    displayName,
  });

  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  return user;
};

export const loginLocalUser = async (input: { username: string; password: string }) => {
  const username = normalizeUsername(input.username);

  const user = await authRequest('login', {
    username,
    password: input.password,
  });

  storage.setSessionUserId(user.id);
  storage.setCurrentUser(user);
  return user;
};

export const logoutLocalUser = () => {
  storage.clearSessionUserId();
  storage.clearCurrentUser();
};