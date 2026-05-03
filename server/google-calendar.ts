import crypto from 'crypto';
import { Pool } from 'pg';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';

const DEFAULT_SYNC_RANGE_DAYS = { past: 30, future: 365 };

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  calendar_time_zone: string | null;
};

type SyncStateRow = {
  sync_token: string | null;
  last_synced_at: string | null;
};

type ChannelRow = {
  channel_id: string;
  resource_id: string;
  expiration: number | null;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

const formatDateInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const formatTimeInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('hour')}:${get('minute')}`;
};

const addDays = (dateStr: string, days: number) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const parseTaskDateTime = (date: string, time: string, timeZone: string) => {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr || '0');
  const minute = Number(minuteStr || '0');
  const pad = (value: number) => String(value).padStart(2, '0');
  const dateTime = `${date}T${pad(hour)}:${pad(minute)}:00`;
  const endMinuteTotal = hour * 60 + minute + 60;
  const endHour = Math.floor(endMinuteTotal / 60) % 24;
  const endMinute = endMinuteTotal % 60;
  const endDate = endHour < hour ? addDays(date, 1) : date;
  const endDateTime = `${endDate}T${pad(endHour)}:${pad(endMinute)}:00`;
  return { dateTime, endDateTime, timeZone };
};

export const eventToTaskFields = (event: GoogleEvent, calendarTimeZone?: string) => {
  const eventTimeZone = event.start?.timeZone || calendarTimeZone || 'UTC';
  if (event.start?.dateTime) {
    const date = new Date(event.start.dateTime);
    return {
      name: event.summary?.trim() || 'Без названия',
      date: formatDateInTimeZone(date, eventTimeZone),
      time: formatTimeInTimeZone(date, eventTimeZone),
      externalUpdatedAt: event.updated || null,
    };
  }

  return {
    name: event.summary?.trim() || 'Без названия',
    date: event.start?.date || '',
    time: '',
    externalUpdatedAt: event.updated || null,
  };
};

export const taskToEventPayload = (task: { name: string; date: string; time?: string }, calendarTimeZone?: string) => {
  const timeZone = calendarTimeZone || 'UTC';
  const trimmedTime = (task.time || '').trim();

  if (trimmedTime) {
    const { dateTime, endDateTime } = parseTaskDateTime(task.date, trimmedTime, timeZone);
    return {
      summary: task.name,
      start: { dateTime, timeZone },
      end: { dateTime: endDateTime, timeZone },
    };
  }

  return {
    summary: task.name,
    start: { date: task.date },
    end: { date: addDays(task.date, 1) },
  };
};

const googleFetch = async (accessToken: string, url: string, options: RequestInit = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Google API error: ${response.status}`);
  }
  return response;
};

const fetchToken = async (payload: Record<string, string>) => {
  const body = new URLSearchParams(payload);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Ошибка обмена токена Google.');
  }
  return data;
};

export const ensureGoogleCalendarSchema = async (db: Pool) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS google_oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT,
      expiry_date TIMESTAMPTZ,
      calendar_id TEXT,
      calendar_name TEXT,
      calendar_time_zone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_channels (
      channel_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      expiration BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_sync (
      user_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      sync_token TEXT,
      last_synced_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, calendar_id)
    );
  `);

  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS external_provider TEXT;`);
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS external_id TEXT;`);
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS external_calendar_id TEXT;`);
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS external_updated_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMPTZ;`);
  await db.query(`CREATE INDEX IF NOT EXISTS user_tasks_external_key ON user_tasks (user_id, external_provider, external_id);`);
};

export const createOAuthState = async (db: Pool, userId: string) => {
  const state = crypto.randomUUID();
  await db.query(`INSERT INTO google_oauth_states (state, user_id) VALUES ($1, $2)`, [state, userId]);
  return state;
};

export const consumeOAuthState = async (db: Pool, state: string) => {
  const result = await db.query(
    `DELETE FROM google_oauth_states WHERE state = $1 RETURNING user_id`,
    [state]
  );
  return result.rows[0]?.user_id || null;
};

export const exchangeCodeForTokens = async (input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) => {
  return fetchToken({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
};

const refreshAccessToken = async (input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) => {
  return fetchToken({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  });
};

export const upsertTokens = async (
  db: Pool,
  userId: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
  }
) => {
  const expiryDate = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await db.query(
    `
      INSERT INTO google_calendar_tokens (
        user_id,
        access_token,
        refresh_token,
        scope,
        token_type,
        expiry_date,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, google_calendar_tokens.refresh_token),
        scope = COALESCE(EXCLUDED.scope, google_calendar_tokens.scope),
        token_type = COALESCE(EXCLUDED.token_type, google_calendar_tokens.token_type),
        expiry_date = EXCLUDED.expiry_date,
        updated_at = NOW()
    `,
    [
      userId,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.scope || null,
      tokens.token_type || null,
      expiryDate,
    ]
  );
};

export const getTokens = async (db: Pool, userId: string): Promise<TokenRow | null> => {
  const result = await db.query(
    `
      SELECT user_id, access_token, refresh_token, scope, token_type, expiry_date,
             calendar_id, calendar_name, calendar_time_zone
      FROM google_calendar_tokens
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
};

export const updateSelectedCalendar = async (
  db: Pool,
  userId: string,
  calendar: { id: string; name: string; timeZone?: string }
) => {
  await db.query(
    `
      UPDATE google_calendar_tokens
      SET calendar_id = $1,
          calendar_name = $2,
          calendar_time_zone = $3,
          updated_at = NOW()
      WHERE user_id = $4
    `,
    [calendar.id, calendar.name, calendar.timeZone || null, userId]
  );
};

export const getValidAccessToken = async (
  db: Pool,
  userId: string,
  clientId: string,
  clientSecret: string
) => {
  const tokens = await getTokens(db, userId);
  if (!tokens) {
    throw new Error('Google Calendar не подключен.');
  }

  const expiryMs = tokens.expiry_date ? new Date(tokens.expiry_date).getTime() : 0;
  if (!expiryMs || expiryMs - Date.now() > 60_000) {
    return tokens;
  }

  if (!tokens.refresh_token) {
    throw new Error('Нужна повторная авторизация Google Calendar.');
  }

  const refreshed = await refreshAccessToken({
    refreshToken: tokens.refresh_token,
    clientId,
    clientSecret,
  });

  await upsertTokens(db, userId, refreshed);
  return { ...tokens, access_token: refreshed.access_token, expiry_date: null };
};

export const listCalendars = async (accessToken: string) => {
  const response = await googleFetch(accessToken, `${GOOGLE_CALENDAR_API}/users/me/calendarList`);
  const data = await response.json();
  return (data.items || []).map((item: any) => ({
    id: String(item.id),
    name: String(item.summary || item.id),
    primary: Boolean(item.primary),
    timeZone: item.timeZone ? String(item.timeZone) : undefined,
  }));
};

export const listEvents = async (input: {
  accessToken: string;
  calendarId: string;
  syncToken?: string | null;
}) => {
  const events: GoogleEvent[] = [];
  let nextPageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const params = new URLSearchParams();
    if (input.syncToken) {
      params.set('syncToken', input.syncToken);
    } else {
      const now = Date.now();
      const timeMin = new Date(now - DEFAULT_SYNC_RANGE_DAYS.past * 86400000).toISOString();
      const timeMax = new Date(now + DEFAULT_SYNC_RANGE_DAYS.future * 86400000).toISOString();
      params.set('timeMin', timeMin);
      params.set('timeMax', timeMax);
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
    }
    params.set('showDeleted', 'true');
    params.set('maxResults', '2500');
    if (nextPageToken) params.set('pageToken', nextPageToken);

    const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`;
    const response = await googleFetch(input.accessToken, url);
    const data = await response.json();

    if (Array.isArray(data.items)) {
      events.push(...data.items);
    }
    nextPageToken = data.nextPageToken;
    if (data.nextSyncToken) {
      nextSyncToken = data.nextSyncToken;
    }
  } while (nextPageToken);

  return { events, nextSyncToken };
};

const ensureCalendarWatch = async (input: {
  db: Pool;
  userId: string;
  calendarId: string;
  accessToken: string;
  webhookUrl: string;
}) => {
  const existing = await input.db.query(
    `
      SELECT channel_id, resource_id, expiration
      FROM google_calendar_channels
      WHERE user_id = $1 AND calendar_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.userId, input.calendarId]
  );

  const row: ChannelRow | null = existing.rows[0] || null;
  const now = Date.now();

  if (row?.expiration && row.expiration - now > 5 * 60 * 1000) {
    return row;
  }

  if (row) {
    try {
      await fetch(`${GOOGLE_CALENDAR_API}/channels/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.channel_id, resourceId: row.resource_id }),
      });
    } catch {
      // best-effort stop
    }
  }

  const channelId = crypto.randomUUID();
  const watchPayload = {
    id: channelId,
    type: 'web_hook',
    address: input.webhookUrl,
    params: { ttl: '86400' },
  };
  const watchResponse = await googleFetch(
    input.accessToken,
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    { method: 'POST', body: JSON.stringify(watchPayload) }
  );
  const data = await watchResponse.json();
  const expiration = data.expiration ? Number(data.expiration) : null;

  await input.db.query(
    `
      INSERT INTO google_calendar_channels (channel_id, user_id, calendar_id, resource_id, expiration)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (channel_id)
      DO UPDATE SET resource_id = EXCLUDED.resource_id, expiration = EXCLUDED.expiration
    `,
    [channelId, input.userId, input.calendarId, data.resourceId, expiration]
  );

  return { channel_id: channelId, resource_id: data.resourceId, expiration };
};

export const syncCalendarEvents = async (input: {
  db: Pool;
  userId: string;
  clientId: string;
  clientSecret: string;
  webhookUrl?: string | null;
  forceFull?: boolean;
}) => {
  const tokens = await getTokens(input.db, input.userId);
  if (!tokens?.calendar_id) {
    throw new Error('Календарь не выбран.');
  }

  const { access_token: accessToken } = await getValidAccessToken(
    input.db,
    input.userId,
    input.clientId,
    input.clientSecret
  );

  const syncStateResult = await input.db.query<SyncStateRow>(
    `
      SELECT sync_token, last_synced_at
      FROM google_calendar_sync
      WHERE user_id = $1 AND calendar_id = $2
      LIMIT 1
    `,
    [input.userId, tokens.calendar_id]
  );
  const syncState = syncStateResult.rows[0] || null;
  const useSyncToken = !input.forceFull && syncState?.sync_token;

  let response: { events: GoogleEvent[]; nextSyncToken?: string };
  try {
    response = await listEvents({
      accessToken,
      calendarId: tokens.calendar_id,
      syncToken: useSyncToken || null,
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('410')) {
      response = await listEvents({
        accessToken,
        calendarId: tokens.calendar_id,
        syncToken: null,
      });
    } else {
      throw error;
    }
  }

  const eventIds = response.events.map((event) => event.id).filter(Boolean);
  const existingResult = eventIds.length
    ? await input.db.query(
        `
          SELECT id, name, time, date, done, updated_at, external_updated_at, external_synced_at, external_id
          FROM user_tasks
          WHERE user_id = $1 AND external_provider = $2 AND external_id = ANY($3)
        `,
        [input.userId, GOOGLE_CALENDAR_PROVIDER, eventIds]
      )
    : { rows: [] as any[] };

  const existingMap = new Map(existingResult.rows.map((row: any) => [row.external_id, row]));
  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const event of response.events) {
    if (!event.id) continue;

    const taskRow = existingMap.get(event.id);
    if (event.status === 'cancelled') {
      if (taskRow) {
        await input.db.query(
          `DELETE FROM user_tasks WHERE id = $1 AND user_id = $2`,
          [taskRow.id, input.userId]
        );
        deleted += 1;
      }
      continue;
    }

    const fields = eventToTaskFields(event, tokens.calendar_time_zone || undefined);

    if (!taskRow) {
      const taskId = crypto.randomUUID();
      await input.db.query(
        `
          INSERT INTO user_tasks (
            id, user_id, name, time, date, done, type, subtasks,
            external_provider, external_id, external_calendar_id, external_updated_at, external_synced_at,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, false, 'regular', '[]'::jsonb,
                  $6, $7, $8, $9, NOW(), NOW(), NOW())
        `,
        [
          taskId,
          input.userId,
          fields.name,
          fields.time,
          fields.date,
          GOOGLE_CALENDAR_PROVIDER,
          event.id,
          tokens.calendar_id,
          fields.externalUpdatedAt,
        ]
      );
      created += 1;
      continue;
    }

    const taskUpdatedAt = new Date(taskRow.updated_at).getTime();
    const externalUpdatedAt = taskRow.external_updated_at
      ? new Date(taskRow.external_updated_at).getTime()
      : 0;
    const externalSyncedAt = taskRow.external_synced_at
      ? new Date(taskRow.external_synced_at).getTime()
      : 0;
    const eventUpdatedAt = event.updated ? new Date(event.updated).getTime() : 0;
    const taskChanged = taskUpdatedAt > externalSyncedAt;
    const eventChanged = eventUpdatedAt > externalUpdatedAt;

    if (taskChanged && eventChanged) {
      const payload = taskToEventPayload(taskRow, tokens.calendar_time_zone || undefined);
      const updateResponse = await googleFetch(
        accessToken,
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendar_id)}/events/${encodeURIComponent(event.id)}`,
        { method: 'PUT', body: JSON.stringify(payload) }
      );
      const updatedEvent = await updateResponse.json();
      await input.db.query(
        `
          UPDATE user_tasks
          SET external_updated_at = $1,
              external_synced_at = NOW(),
              external_calendar_id = $2
          WHERE id = $3 AND user_id = $4
        `,
        [updatedEvent.updated || null, tokens.calendar_id, taskRow.id, input.userId]
      );
      updated += 1;
      continue;
    }

    if (eventChanged && !taskChanged) {
      await input.db.query(
        `
          UPDATE user_tasks
          SET name = $1,
              time = $2,
              date = $3,
              external_updated_at = $4,
              external_calendar_id = $5,
              external_synced_at = NOW(),
              updated_at = NOW()
          WHERE id = $6 AND user_id = $7
        `,
        [
          fields.name,
          fields.time,
          fields.date,
          fields.externalUpdatedAt,
          tokens.calendar_id,
          taskRow.id,
          input.userId,
        ]
      );
      updated += 1;
      continue;
    }

    if (taskChanged && !eventChanged) {
      const payload = taskToEventPayload(taskRow, tokens.calendar_time_zone || undefined);
      const updateResponse = await googleFetch(
        accessToken,
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendar_id)}/events/${encodeURIComponent(event.id)}`,
        { method: 'PUT', body: JSON.stringify(payload) }
      );
      const updatedEvent = await updateResponse.json();
      await input.db.query(
        `
          UPDATE user_tasks
          SET external_updated_at = $1,
              external_synced_at = NOW(),
              external_calendar_id = $2
          WHERE id = $3 AND user_id = $4
        `,
        [updatedEvent.updated || null, tokens.calendar_id, taskRow.id, input.userId]
      );
      updated += 1;
    }
  }

  await input.db.query(
    `
      INSERT INTO google_calendar_sync (user_id, calendar_id, sync_token, last_synced_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, calendar_id)
      DO UPDATE SET sync_token = EXCLUDED.sync_token, last_synced_at = NOW()
    `,
    [input.userId, tokens.calendar_id, response.nextSyncToken || null]
  );

  if (input.webhookUrl) {
    await ensureCalendarWatch({
      db: input.db,
      userId: input.userId,
      calendarId: tokens.calendar_id,
      accessToken,
      webhookUrl: input.webhookUrl,
    });
  }

  return { created, updated, deleted };
};

export const syncTaskToGoogle = async (input: {
  db: Pool;
  userId: string;
  task: { id: string; name: string; time?: string; date: string };
  clientId: string;
  clientSecret: string;
}) => {
  const tokens = await getTokens(input.db, input.userId);
  if (!tokens?.calendar_id) {
    return { skipped: true, reason: 'calendar_not_selected' };
  }

  const { access_token: accessToken } = await getValidAccessToken(
    input.db,
    input.userId,
    input.clientId,
    input.clientSecret
  );

  const existing = await input.db.query(
    `
      SELECT external_id, external_provider, external_calendar_id
      FROM user_tasks
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.task.id, input.userId]
  );
  const row = existing.rows[0] || null;
  const calendarId = tokens.calendar_id;

  if (row?.external_provider === GOOGLE_CALENDAR_PROVIDER && row.external_id) {
    const payload = taskToEventPayload(input.task, tokens.calendar_time_zone || undefined);
    const updateResponse = await googleFetch(
      accessToken,
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(row.external_id)}`,
      { method: 'PUT', body: JSON.stringify(payload) }
    );
    const updatedEvent = await updateResponse.json();
    await input.db.query(
      `
        UPDATE user_tasks
        SET external_provider = $1,
            external_id = $2,
            external_calendar_id = $3,
            external_updated_at = $4,
            external_synced_at = NOW()
        WHERE id = $5 AND user_id = $6
      `,
      [
        GOOGLE_CALENDAR_PROVIDER,
        row.external_id,
        calendarId,
        updatedEvent.updated || null,
        input.task.id,
        input.userId,
      ]
    );
    return { updated: true, eventId: row.external_id };
  }

  const payload = taskToEventPayload(input.task, tokens.calendar_time_zone || undefined);
  const createResponse = await googleFetch(
    accessToken,
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
  const createdEvent = await createResponse.json();
  await input.db.query(
    `
      UPDATE user_tasks
      SET external_provider = $1,
          external_id = $2,
          external_calendar_id = $3,
          external_updated_at = $4,
          external_synced_at = NOW()
      WHERE id = $5 AND user_id = $6
    `,
    [
      GOOGLE_CALENDAR_PROVIDER,
      createdEvent.id,
      calendarId,
      createdEvent.updated || null,
      input.task.id,
      input.userId,
    ]
  );
  return { created: true, eventId: createdEvent.id };
};

export const deleteTaskFromGoogle = async (input: {
  db: Pool;
  userId: string;
  taskId: string;
  clientId: string;
  clientSecret: string;
}) => {
  const tokens = await getTokens(input.db, input.userId);
  if (!tokens?.calendar_id) {
    return { skipped: true, reason: 'calendar_not_selected' };
  }

  const mapping = await input.db.query(
    `
      SELECT external_id, external_provider, external_calendar_id
      FROM user_tasks
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.taskId, input.userId]
  );
  const row = mapping.rows[0];
  if (!row || row.external_provider !== GOOGLE_CALENDAR_PROVIDER || !row.external_id) {
    return { skipped: true, reason: 'no_mapping' };
  }

  const { access_token: accessToken } = await getValidAccessToken(
    input.db,
    input.userId,
    input.clientId,
    input.clientSecret
  );

  await googleFetch(
    accessToken,
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(tokens.calendar_id)}/events/${encodeURIComponent(row.external_id)}`,
    { method: 'DELETE' }
  );

  return { deleted: true, eventId: row.external_id };
};

export const getCalendarStatus = async (db: Pool, userId: string) => {
  const tokens = await getTokens(db, userId);
  if (!tokens) {
    return { connected: false };
  }

  const syncState = tokens.calendar_id
    ? await db.query<SyncStateRow>(
        `
          SELECT sync_token, last_synced_at
          FROM google_calendar_sync
          WHERE user_id = $1 AND calendar_id = $2
          LIMIT 1
        `,
        [userId, tokens.calendar_id]
      )
    : { rows: [] as SyncStateRow[] };

  const channel = tokens.calendar_id
    ? await db.query<ChannelRow>(
        `
          SELECT channel_id, resource_id, expiration
          FROM google_calendar_channels
          WHERE user_id = $1 AND calendar_id = $2
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [userId, tokens.calendar_id]
      )
    : { rows: [] as ChannelRow[] };

  return {
    connected: true,
    calendar: tokens.calendar_id
      ? {
          id: tokens.calendar_id,
          name: tokens.calendar_name || tokens.calendar_id,
          timeZone: tokens.calendar_time_zone || null,
        }
      : null,
    lastSyncAt: syncState.rows[0]?.last_synced_at || null,
    watch: channel.rows[0] || null,
  };
};

export const disconnectCalendar = async (input: {
  db: Pool;
  userId: string;
  clientId: string;
  clientSecret: string;
}) => {
  const tokens = await getTokens(input.db, input.userId);
  if (tokens?.calendar_id) {
    const channel = await input.db.query<ChannelRow>(
      `
        SELECT channel_id, resource_id
        FROM google_calendar_channels
        WHERE user_id = $1 AND calendar_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.userId, tokens.calendar_id]
    );
    if (channel.rows[0]) {
      await fetch(`${GOOGLE_CALENDAR_API}/channels/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: channel.rows[0].channel_id, resourceId: channel.rows[0].resource_id }),
      });
    }
  }

  await input.db.query(`DELETE FROM google_calendar_channels WHERE user_id = $1`, [input.userId]);
  await input.db.query(`DELETE FROM google_calendar_sync WHERE user_id = $1`, [input.userId]);
  await input.db.query(`DELETE FROM google_calendar_tokens WHERE user_id = $1`, [input.userId]);

  return { disconnected: true };
};

export const findWebhookTarget = async (db: Pool, channelId: string) => {
  const result = await db.query(
    `
      SELECT user_id, calendar_id
      FROM google_calendar_channels
      WHERE channel_id = $1
      LIMIT 1
    `,
    [channelId]
  );
  return result.rows[0] || null;
};

