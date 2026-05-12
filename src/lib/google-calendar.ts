import { Task } from '../types';
import { getCurrentUser } from './auth';

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type StoredToken = {
  accessToken: string;
  expiresAt: number;
};

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
  callback?: (response: GoogleTokenResponse) => void;
};

type GooglePrompt = 'consent' | 'none' | 'select_account';

export type GoogleCalendarItem = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  selected?: boolean;
};

const CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_TTL_BUFFER_MS = 60_000;
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const TOKEN_STORAGE_PREFIX = 'mx_google_calendar_token_';
const CALENDAR_ID_STORAGE_PREFIX = 'mx_google_calendar_id_';

let googleScriptPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let cachedClientId: string | null = null;

const loadGoogleScript = async () => {
  const accounts = (window as any).google?.accounts;
  if (accounts?.oauth2?.initTokenClient) {
    return;
  }
  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Google script failed to load.')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google script failed to load.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleScriptPromise = null;
    throw error;
  });

  return googleScriptPromise;
};

const fetchGoogleClientId = async () => {
  if (cachedClientId) {
    return cachedClientId;
  }

  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  if (envClientId) {
    cachedClientId = envClientId;
    return cachedClientId;
  }

  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      return '';
    }
    const data = await response.json().catch((error) => {
      console.warn(`[GCAL] Не удалось разобрать ответ /api/config (status ${response.status}).`, error);
      return null;
    }) as { googleClientId?: string } | null;
    cachedClientId = data?.googleClientId || '';
    return cachedClientId;
  } catch {
    return '';
  }
};

const tokenStorageKey = (userId: string) => `${TOKEN_STORAGE_PREFIX}${userId}`;

const readStoredToken = (userId: string): StoredToken | null => {
  const raw = localStorage.getItem(tokenStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

const storeToken = (userId: string, token: StoredToken) => {
  localStorage.setItem(tokenStorageKey(userId), JSON.stringify(token));
};

const clearToken = (userId: string) => {
  localStorage.removeItem(tokenStorageKey(userId));
};

const isTokenValid = (token: StoredToken) =>
  token.expiresAt - TOKEN_TTL_BUFFER_MS > Date.now();

const getTokenClient = async (): Promise<TokenClient> => {
  if (tokenClient) return tokenClient;

  const clientId = await fetchGoogleClientId();
  if (!clientId) {
    throw new Error('Google client id не настроен.');
  }

  await loadGoogleScript();

  const accounts = (window as any).google?.accounts;
  if (!accounts?.oauth2?.initTokenClient) {
    throw new Error('Google OAuth не доступен в текущем окружении.');
  }

  tokenClient = accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: CALENDAR_SCOPE,
    callback: () => undefined,
  });

  return tokenClient;
};

const requestAccessToken = async (prompt: GooglePrompt): Promise<StoredToken | null> => {
  const userId = getCurrentUser()?.id;
  if (!userId) return null;

  const client = await getTokenClient();

  const response = await new Promise<GoogleTokenResponse>((resolve) => {
    client.callback = (tokenResponse) => resolve(tokenResponse);
    client.requestAccessToken({ prompt });
  });

  if (!response.access_token) {
    return null;
  }

  const token: StoredToken = {
    accessToken: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };

  const activeUserId = getCurrentUser()?.id;
  if (!activeUserId || activeUserId !== userId) {
    return null;
  }
  storeToken(activeUserId, token);
  return token;
};

export const isGoogleCalendarConnected = () => {
  const userId = getCurrentUser()?.id;
  if (!userId) return false;
  const token = readStoredToken(userId);
  return Boolean(token);
};

export const connectGoogleCalendar = async () => {
  const token = await requestAccessToken('consent');
  return Boolean(token);
};

export const disconnectGoogleCalendar = () => {
  const userId = getCurrentUser()?.id;
  if (!userId) return;
  clearToken(userId);
  localStorage.removeItem(`${CALENDAR_ID_STORAGE_PREFIX}${userId}`);
  // Reset cached token client so next connect uses updated scopes
  tokenClient = null;
};

export const getSelectedCalendarId = (): string => {
  const userId = getCurrentUser()?.id;
  if (!userId) return 'primary';
  return localStorage.getItem(`${CALENDAR_ID_STORAGE_PREFIX}${userId}`) || 'primary';
};

export const setSelectedCalendarId = (calendarId: string) => {
  const userId = getCurrentUser()?.id;
  if (!userId) return;
  localStorage.setItem(`${CALENDAR_ID_STORAGE_PREFIX}${userId}`, calendarId);
};

export const fetchCalendarList = async (): Promise<GoogleCalendarItem[]> => {
  const accessToken = await ensureGoogleCalendarToken({ allowPrompt: false });
  if (!accessToken) return [];

  const response = await calendarRequest('/users/me/calendarList', 'GET', accessToken);
  if (!response.ok) return [];

  const data = await response.json().catch(() => null) as { items?: GoogleCalendarItem[] } | null;
  return data?.items ?? [];
};

const ensureGoogleCalendarToken = async (options: { allowPrompt?: boolean } = {}): Promise<string | null> => {
  const userId = getCurrentUser()?.id;
  if (!userId) return null;

  const stored = readStoredToken(userId);
  if (stored && isTokenValid(stored)) {
    return stored.accessToken;
  }

  const hadStoredToken = Boolean(stored);
  if (stored && !isTokenValid(stored)) {
    clearToken(userId);
  }

  const { allowPrompt = true } = options;
  if (hadStoredToken) {
    const silent = await requestAccessToken('none');
    if (silent?.accessToken) {
      return silent.accessToken;
    }
  }

  if (!allowPrompt) {
    return null;
  }

  const consent = await requestAccessToken('consent');
  return consent?.accessToken ?? null;
};

const formatOffset = (offsetMinutes: number) => {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
};

const buildDateTime = (date: string, time: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  const offset = -local.getTimezoneOffset();
  const tz = formatOffset(offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:00${tz}`;
};

const buildEventPayload = (task: Task) => {
  if (!task.date) return null;

  if (!task.time) {
    const [year, month, day] = task.date.split('-').map(Number);
    const startDate = new Date(year, month - 1, day);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
    const pad = (value: number) => String(value).padStart(2, '0');
    const dateToString = (value: Date) =>
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return {
      summary: task.name,
      description: task.description || undefined,
      location: task.location || undefined,
      start: { date: dateToString(startDate) },
      end: { date: dateToString(endDate) },
      extendedProperties: {
        private: { mindexTaskId: task.id },
      },
    };
  }

  const start = buildDateTime(task.date, task.time);
  const [hour, minute] = task.time.split(':').map(Number);
  const [year, month, day] = task.date.split('-').map(Number);
  const endDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  endDate.setMinutes(endDate.getMinutes() + DEFAULT_EVENT_DURATION_MINUTES);
  const end = buildDateTime(
    `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`,
    `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`,
  );

  return {
    summary: task.name,
    description: task.description || undefined,
    location: task.location || undefined,
    start: { dateTime: start },
    end: { dateTime: end },
    extendedProperties: {
      private: { mindexTaskId: task.id },
    },
  };
};

const calendarRequest = async (path: string, method: string, accessToken: string, body?: object) => {
  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
};

const createCalendarEvent = async (accessToken: string, payload: object) => {
  const calendarId = getSelectedCalendarId();
  const response = await calendarRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, 'POST', accessToken, payload);
  if (response.status === 401 || response.status === 403) {
    const userId = getCurrentUser()?.id;
    if (userId) clearToken(userId);
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`[GCAL] Ошибка создания события: ${response.status} ${text}`);
    return null;
  }
  const data = await response.json().catch(() => null) as { id?: string } | null;
  if (!data?.id) {
    console.warn('[GCAL] Ответ создания события без id.');
    return null;
  }
  return data.id;
};

export const syncGoogleCalendarTask = async (task: Task): Promise<Task | null> => {
  const accessToken = await ensureGoogleCalendarToken({ allowPrompt: false });
  if (!accessToken) return null;

  const payload = buildEventPayload(task);
  if (!payload) return null;

  const calendarId = getSelectedCalendarId();

  if (task.calendarEventId) {
    const response = await calendarRequest(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(task.calendarEventId)}`,
      'PATCH',
      accessToken,
      payload,
    );

    if (response.status === 404) {
      const eventId = await createCalendarEvent(accessToken, payload);
      if (!eventId) return null;
      return { ...task, calendarEventId: eventId };
    }

    if (response.status === 401 || response.status === 403) {
      const userId = getCurrentUser()?.id;
      if (userId) clearToken(userId);
    }

    if (response.ok) {
      return task;
    }

    return null;
  }

  const eventId = await createCalendarEvent(accessToken, payload);
  if (!eventId) return null;
  return { ...task, calendarEventId: eventId };
};

export const deleteGoogleCalendarEvent = async (eventId: string) => {
  const accessToken = await ensureGoogleCalendarToken({ allowPrompt: false });
  if (!accessToken) return;

  const calendarId = getSelectedCalendarId();
  const response = await calendarRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    'DELETE',
    accessToken,
  );

  if (response.status === 401 || response.status === 403) {
    const userId = getCurrentUser()?.id;
    if (userId) clearToken(userId);
  }
};
