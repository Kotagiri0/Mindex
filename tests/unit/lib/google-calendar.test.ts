import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchCalendarList,
  getSelectedCalendarId,
  isGoogleCalendarConnected,
  setSelectedCalendarId,
  syncGoogleCalendarTask,
  deleteGoogleCalendarEvent,
} from '../../../src/lib/google-calendar';
import { storage } from '../../../src/lib/storage';
import { installDomStubs } from '../../helpers/dom';
import { jsonResponse } from '../../helpers/response';
import type { Task } from '../../../src/types';

beforeEach(() => {
  installDomStubs();
  storage.setCurrentUser({ id: 'user-1', username: 'demo', displayName: 'Demo', createdAt: 1 });
});

const seedToken = () => {
  localStorage.setItem('mx_google_calendar_token_user-1', JSON.stringify({
    accessToken: 'token',
    expiresAt: Date.now() + 10_000,
  }));
};

test('detects calendar connection when token stored', () => {
  assert.equal(isGoogleCalendarConnected(), false);
  seedToken();
  assert.equal(isGoogleCalendarConnected(), true);
});

test('connects calendar using token client', async () => {
  const tokenClient: any = {
    callback: undefined,
    requestAccessToken: ({ prompt }: { prompt?: string }) => {
      assert.equal(prompt, 'consent');
      if (tokenClient.callback) {
        tokenClient.callback({ access_token: 'token', expires_in: 3600 });
      }
    },
  };

  (globalThis as any).window.google = {
    accounts: {
      oauth2: {
        initTokenClient: () => tokenClient,
      },
    },
  };

  (globalThis as any).window.google.accounts.oauth2.initTokenClient = () => tokenClient;

  const connected = await connectGoogleCalendar();
  assert.equal(connected, true);
});

test('disconnect clears stored calendar data', () => {
  seedToken();
  localStorage.setItem('mx_google_calendar_id_user-1', 'cal-1');
  disconnectGoogleCalendar();
  assert.equal(localStorage.getItem('mx_google_calendar_token_user-1'), null);
  assert.equal(localStorage.getItem('mx_google_calendar_id_user-1'), null);
});

test('gets and sets selected calendar id', () => {
  assert.equal(getSelectedCalendarId(), 'primary');
  setSelectedCalendarId('cal-1');
  assert.equal(getSelectedCalendarId(), 'cal-1');
});

test('returns empty calendar list without token', async () => {
  localStorage.removeItem('mx_google_calendar_token_user-1');
  const calendars = await fetchCalendarList();
  assert.deepEqual(calendars, []);
});

test('fetches calendar list when token exists', async () => {
  seedToken();
  (globalThis as any).fetch = async () =>
    jsonResponse({ items: [{ id: 'primary', summary: 'Main' }] });

  const calendars = await fetchCalendarList();
  assert.equal(calendars[0].id, 'primary');
});

test('syncs calendar task by creating event', async () => {
  seedToken();
  (globalThis as any).fetch = async (url: string, options: any) => {
    assert.equal(options.method, 'POST');
    assert.ok(url.includes('/events'));
    return jsonResponse({ id: 'event-1' });
  };

  const task: Task = { id: 't1', name: 'Task', date: '2026-05-18', time: '', done: false };
  const result = await syncGoogleCalendarTask(task);
  assert.equal(result?.calendarEventId, 'event-1');
});

test('clears token on delete event auth failure', async () => {
  seedToken();
  (globalThis as any).fetch = async () => new Response('', { status: 401 });
  await deleteGoogleCalendarEvent('event-1');
  assert.equal(localStorage.getItem('mx_google_calendar_token_user-1'), null);
});
