import { LocalUser } from '../types';
import { storage } from './storage';

const hashSecret = async (value: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

export const getCurrentUser = (): LocalUser | null => {
  const userId = storage.getSessionUserId();
  if (!userId) return null;
  return storage.getUsers().find((user) => user.id === userId) || null;
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

  const users = storage.getUsers();
  if (users.some((user) => user.username === username)) {
    throw new Error('Такой пользователь уже существует.');
  }

  const user: LocalUser = {
    id: crypto.randomUUID(),
    username,
    displayName: displayName || username,
    passwordHash: await hashSecret(`${username}:${input.password}`),
    createdAt: Date.now(),
  };

  storage.setUsers([user, ...users]);
  storage.setSessionUserId(user.id);
  return user;
};

export const loginLocalUser = async (input: { username: string; password: string }) => {
  const username = normalizeUsername(input.username);
  const users = storage.getUsers();
  const user = users.find((item) => item.username === username);

  if (!user) {
    throw new Error('Пользователь не найден.');
  }

  const passwordHash = await hashSecret(`${username}:${input.password}`);
  if (passwordHash !== user.passwordHash) {
    throw new Error('Неверный пароль.');
  }

  storage.setSessionUserId(user.id);
  return user;
};

export const logoutLocalUser = () => {
  storage.clearSessionUserId();
};