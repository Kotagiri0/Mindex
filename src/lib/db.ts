import { Task, Thread, Settings, LocalProfile } from '../types';
import { getCurrentUser } from './auth';
import { deleteGoogleCalendarEvent, syncGoogleCalendarTask } from './google-calendar';
import { storage } from './storage';

const getUserId = () => getCurrentUser()?.id;
const apiBase = () => `${window.location.origin}/api/data`;

const authHeaders = (): Record<string, string> => {
  const token = storage.getSessionToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const merged: RequestInit = {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options?.headers as Record<string, string> || {}),
    },
  };
  const response = await fetch(url, merged);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

const defaultProfile = (): LocalProfile => ({
  settings: storage.getDefaultSettings(),
  onboarding_complete: false,
  updated_at: new Date().toISOString(),
});

const persistTask = async (userId: string, task: Task) => {
  const tasks = storage.getTasks(userId);
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) tasks[index] = task;
  else tasks.unshift(task);
  storage.setTasks(userId, tasks);

  try {
    await request<{ success: boolean }>(`${apiBase()}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
  } catch {
    // Local fallback already saved.
  }
};

const mergeStoredCalendarEvent = (userId: string, task: Task) => {
  if (task.calendarEventId) return task;
  const stored = storage.getTasks(userId).find((item) => item.id === task.id);
  if (!stored?.calendarEventId) return task;
  return { ...task, calendarEventId: stored.calendarEventId };
};

export const db = {
  getUserId: () => getCurrentUser()?.id,
  getProfile: async () => {
    const userId = db.getUserId();
    if (!userId) {
      return defaultProfile();
    }

    try {
      const data = await request<{ profile: LocalProfile | null; tasks: Task[]; threads: Thread[] }>(
        `${apiBase()}/bootstrap`
      );

      if (data.profile) {
        storage.setProfile(userId, data.profile);
      }

      return data.profile || storage.getProfile(userId);
    } catch {
      return storage.getProfile(userId);
    }
  },
  
  upsertProfile: async (onboardingComplete: boolean, settings: Settings) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    storage.setProfile(userId, {
      settings,
      onboarding_complete: onboardingComplete,
      updated_at: new Date().toISOString(),
    });

    try {
      await request<{ success: boolean }>(`${apiBase()}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings, onboarding_complete: onboardingComplete }),
      });
    } catch {
      // Offline/DB unavailable: local fallback is already saved.
    }
  },

  getThreads: async (): Promise<Thread[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const localThreads = storage.getThreads(userId);

    try {
      const data = await request<{ profile: LocalProfile | null; tasks: Task[]; threads: Thread[] }>(
        `${apiBase()}/bootstrap`
      );
      const serverThreads = data.threads || [];
      const serverIds = new Set(serverThreads.map((t) => t.id));
      // Треды, которые есть локально но не на сервере — pending-save, сохраняем обратно
      const pendingLocal = localThreads.filter((t) => !serverIds.has(t.id));
      for (const t of pendingLocal) {
        db.saveThread(t).catch(() => {});
      }
      const merged = [...pendingLocal, ...serverThreads].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
      storage.setThreads(userId, merged);
      return merged;
    } catch {
      return localThreads.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    }
  },
  
  saveThread: async (thread: Thread) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const updated = { ...thread, updatedAt: Date.now() };
    const threads = storage.getThreads(userId);
    const index = threads.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      threads[index] = updated;
    } else {
      threads.unshift(updated);
    }
    storage.setThreads(userId, threads);

    try {
      await request<{ success: boolean }>(`${apiBase()}/thread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread: updated }),
      });
    } catch (err) {
      console.error('[db] saveThread failed, thread only in localStorage:', err);
    }
  },
  
  archiveThread: async (id: string) => {
    const userId = getUserId();
    if (!userId) return;

    try {
      await request<{ success: boolean }>(`${apiBase()}/thread/${encodeURIComponent(id)}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // Local fallback not needed — source update is server-side only
    }
  },

  deleteThread: async (id: string) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const threads = storage.getThreads(userId).filter((t) => t.id !== id);
    storage.setThreads(userId, threads);

    try {
      await request<{ success: boolean }>(
        `${apiBase()}/thread/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
    } catch {
      // Local fallback already saved.
    }
  },

  getTasks: async (): Promise<Task[]> => {
    const userId = getUserId();
    if (!userId) return [];

    const localTasks = storage.getTasks(userId);

    try {
      const data = await request<{ profile: LocalProfile | null; tasks: Task[]; threads: Thread[] }>(
        `${apiBase()}/bootstrap`
      );
      const serverTasks = data.tasks || [];
      const serverIds = new Set(serverTasks.map((t) => t.id));
      // Задачи, которые есть локально но не на сервере — pending-save, сохраняем обратно
      const pendingLocal = localTasks.filter((t) => !serverIds.has(t.id));
      for (const t of pendingLocal) {
        db.saveTask(t, { skipCalendarSync: true }).catch(() => {});
      }
      const merged = [...pendingLocal, ...serverTasks];
      storage.setTasks(userId, merged);
      return merged;
    } catch {
      return localTasks;
    }
  },

  refreshTasks: async (): Promise<Task[]> => {
    const userId = getUserId();
    if (!userId) return [];

    try {
      const data = await request<{ tasks: Task[] }>(
        `${apiBase()}/bootstrap`
      );
      const serverTasks = data.tasks || [];
      storage.setTasks(userId, serverTasks);
      return serverTasks;
    } catch {
      return storage.getTasks(userId);
    }
  },
  
  saveTask: async (task: Task, options?: { skipCalendarSync?: boolean }) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const baseTask = mergeStoredCalendarEvent(userId, task);
    await persistTask(userId, baseTask);

    if (options?.skipCalendarSync) {
      return;
    }

    try {
      const syncedTask = await syncGoogleCalendarTask(baseTask);
      if (syncedTask?.calendarEventId && syncedTask.calendarEventId !== baseTask.calendarEventId) {
        await persistTask(userId, syncedTask);
      }
    } catch (error) {
      console.warn('[GCAL] Sync failed for task', { userId, taskId: baseTask.id, error });
    }
  },
  
  deleteTask: async (id: string) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const storedTasks = storage.getTasks(userId);
    const existing = storedTasks.find((task) => task.id === id);
    if (existing?.calendarEventId) {
      try {
        await deleteGoogleCalendarEvent(existing.calendarEventId);
      } catch {
        // Ignore calendar delete failures.
      }
    }

    const tasks = storedTasks.filter((task) => task.id !== id);
    storage.setTasks(userId, tasks);

    try {
      await request<{ success: boolean }>(
        `${apiBase()}/task/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
    } catch {
      // Local fallback already saved.
    }
  }
};
