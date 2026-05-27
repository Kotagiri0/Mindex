import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchCalendarList,
  getSelectedCalendarId,
  isGoogleMeetEnabled,
  isGoogleCalendarConnected,
  setGoogleMeetEnabled,
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
  (globalThis as any).fetch = async (url: string) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    return new Response('', { status: 200 });
  };
});

const seedToken = () => {
  localStorage.setItem('mx_google_calendar_token_user-1', JSON.stringify({
    accessToken: 'token',
    expiresAt: Date.now() + 120_000,
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
  localStorage.setItem('mx_google_meet_enabled_user-1', 'true');
  disconnectGoogleCalendar();
  assert.equal(localStorage.getItem('mx_google_calendar_token_user-1'), null);
  assert.equal(localStorage.getItem('mx_google_calendar_id_user-1'), null);
  assert.equal(localStorage.getItem('mx_google_meet_enabled_user-1'), null);
});

test('gets and sets selected calendar id', () => {
  assert.equal(getSelectedCalendarId(), 'primary');
  setSelectedCalendarId('cal-1');
  assert.equal(getSelectedCalendarId(), 'cal-1');
});

test('gets and sets google meet toggle', () => {
  assert.equal(isGoogleMeetEnabled(), false);
  setGoogleMeetEnabled(true);
  assert.equal(isGoogleMeetEnabled(), true);
});

test('returns empty calendar list without token', async () => {
  localStorage.removeItem('mx_google_calendar_token_user-1');
  const calendars = await fetchCalendarList();
  assert.deepEqual(calendars, []);
});

test('fetches calendar list when token exists', async () => {
  seedToken();
  (globalThis as any).fetch = async (url: string) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    return jsonResponse({ items: [{ id: 'primary', summary: 'Main' }] });
  };

  const calendars = await fetchCalendarList();
  assert.equal(calendars[0].id, 'primary');
});

test('syncs calendar task by creating event', async () => {
  seedToken();
  setGoogleMeetEnabled(true);
  (globalThis as any).fetch = async (url: string, options: any) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    assert.equal(options.method, 'POST');
    assert.ok(url.includes('/events'));
    assert.ok(url.includes('conferenceDataVersion=1'));
    const payload = JSON.parse(options.body);
    assert.equal(payload.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    return jsonResponse({ id: 'event-1', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
  };

  const task: Task = { id: 't1', name: 'Task', date: '2026-05-18', time: '10:00', done: false };
  const result = await syncGoogleCalendarTask(task);
  assert.equal(result?.calendarEventId, 'event-1');
  assert.equal(result?.description, 'Google Meet: https://meet.google.com/abc-defg-hij');
});

test('does not create meet conference for all-day event', async () => {
  seedToken();
  setGoogleMeetEnabled(true);
  (globalThis as any).fetch = async (url: string, options: any) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    assert.equal(options.method, 'POST');
    assert.ok(!url.includes('conferenceDataVersion=1'));
    const payload = JSON.parse(options.body);
    assert.equal(payload.conferenceData, undefined);
    return jsonResponse({ id: 'event-1' });
  };

  const task: Task = { id: 't1', name: 'Task', date: '2026-05-18', time: '', done: false };
  const result = await syncGoogleCalendarTask(task);
  assert.equal(result?.calendarEventId, 'event-1');
});

test('updates existing event and appends meet link to description', async () => {
  seedToken();
  setGoogleMeetEnabled(true);
  (globalThis as any).fetch = async (url: string, options: any) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    assert.equal(options.method, 'PATCH');
    assert.ok(url.includes('conferenceDataVersion=1'));
    return jsonResponse({ id: 'event-3', hangoutLink: 'https://meet.google.com/patch-link' });
  };

  const task: Task = { id: 't3', name: 'Task', date: '2026-05-18', time: '11:30', done: false, calendarEventId: 'event-3' };
  const result = await syncGoogleCalendarTask(task);
  assert.equal(result?.calendarEventId, 'event-3');
  assert.equal(result?.description, 'Google Meet: https://meet.google.com/patch-link');
});

test('updates calendar task with time and recreates missing event', async () => {
  seedToken();
  let created = false;
  (globalThis as any).fetch = async (url: string, options: any) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    if (options.method === 'PATCH') {
      return new Response('', { status: 404 });
    }
    if (options.method === 'POST') {
      created = true;
      return jsonResponse({ id: 'event-2', hangoutLink: 'https://meet.google.com/new-link' });
    }
    return new Response('', { status: 200 });
  };

  setGoogleMeetEnabled(true);
  const task: Task = { id: 't2', name: 'Task', date: '2026-05-18', time: '09:30', done: false, calendarEventId: 'old', description: 'План на созвон' };
  const result = await syncGoogleCalendarTask(task);
  assert.equal(result?.calendarEventId, 'event-2');
  assert.equal(result?.description, 'План на созвон\n\nGoogle Meet: https://meet.google.com/new-link');
  assert.equal(created, true);
});

test('clears token on delete event auth failure', async () => {
  seedToken();
  (globalThis as any).fetch = async (url: string) => {
    if (url === '/api/config') {
      return jsonResponse({ googleClientId: 'client' });
    }
    return new Response('', { status: 401 });
  };
  await deleteGoogleCalendarEvent('event-1');
  assert.equal(localStorage.getItem('mx_google_calendar_token_user-1'), null);
});
