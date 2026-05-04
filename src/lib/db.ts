import { Task, Thread, Settings, LocalProfile } from '../types';
import { getCurrentUser } from './auth';
import { deleteGoogleCalendarEvent, syncGoogleCalendarTask } from './google-calendar';
import { storage } from './storage';

const getUserId = () => getCurrentUser()?.id;
const apiBase = () => `${window.location.origin}/api/data`;

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options);
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
      body: JSON.stringify({ userId, task }),
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
        `${apiBase()}/bootstrap?userId=${encodeURIComponent(userId)}`
      );

      if (data.profile) {
        storage.setProfile(userId, data.profile);
      }

      storage.setTasks(userId, data.tasks || []);
      storage.setThreads(userId, data.threads || []);

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
        body: JSON.stringify({
          userId,
          settings,
          onboarding_complete: onboardingComplete,
        }),
      });
    } catch {
      // Offline/DB unavailable: local fallback is already saved.
    }
  },

  getThreads: async (): Promise<Thread[]> => {
    const userId = getUserId();
    if (!userId) return [];

    try {
      const data = await request<{ profile: LocalProfile | null; tasks: Task[]; threads: Thread[] }>(
        `${apiBase()}/bootstrap?userId=${encodeURIComponent(userId)}`
      );
      storage.setThreads(userId, data.threads || []);
      return (data.threads || []).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return storage.getThreads(userId).sort((a, b) => b.createdAt - a.createdAt);
    }
  },
  
  saveThread: async (thread: Thread) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const threads = storage.getThreads(userId);
    const index = threads.findIndex((item) => item.id === thread.id);
    if (index >= 0) {
      threads[index] = thread;
    } else {
      threads.unshift(thread);
    }
    storage.setThreads(userId, threads);

    try {
      await request<{ success: boolean }>(`${apiBase()}/thread`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, thread }),
      });
    } catch {
      // Local fallback already saved.
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
        `${apiBase()}/thread/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' }
      );
    } catch {
      // Local fallback already saved.
    }
  },

  getTasks: async (): Promise<Task[]> => {
    const userId = getUserId();
    if (!userId) return [];

    try {
      const data = await request<{ profile: LocalProfile | null; tasks: Task[]; threads: Thread[] }>(
        `${apiBase()}/bootstrap?userId=${encodeURIComponent(userId)}`
      );
      storage.setTasks(userId, data.tasks || []);
      return data.tasks || [];
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
    } catch {
      // Sync is optional; keep local task saved even if calendar fails.
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
        `${apiBase()}/task/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' }
      );
    } catch {
      // Local fallback already saved.
    }
  }
};
