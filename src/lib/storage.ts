import { LocalProfile, LocalUser, Settings, Task, Thread } from '../types';

const USERS_KEY = 'mx_users';
const SESSION_KEY = 'mx_session_user_id';
const CURRENT_USER_KEY = 'mx_current_user';
const LEGACY_TASKS_KEY = 'mx_tasks';
const LEGACY_THREADS_KEY = 'mx_threads';
const LEGACY_SETTINGS_KEY = 'mx_settings';
const LEGACY_PROFILE_KEY = 'mx_ob_complete';

const defaultSettings = (): Settings => ({ agent: true, confirm: true, notifs: true });

const readJson = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const profileKey = (userId: string) => `mx_profile_${userId}`;
const tasksKey = (userId: string) => `mx_tasks_${userId}`;
const threadsKey = (userId: string) => `mx_threads_${userId}`;

const migrateLegacyTasks = (userId: string) => {
  const userTasksKey = tasksKey(userId);
  if (localStorage.getItem(userTasksKey)) return;
  const legacyTasks = localStorage.getItem(LEGACY_TASKS_KEY);
  if (legacyTasks) {
    localStorage.setItem(userTasksKey, legacyTasks);
  }
};

const migrateLegacyThreads = (userId: string) => {
  const userThreadsKey = threadsKey(userId);
  if (localStorage.getItem(userThreadsKey)) return;
  const legacyThreads = localStorage.getItem(LEGACY_THREADS_KEY);
  if (legacyThreads) {
    localStorage.setItem(userThreadsKey, legacyThreads);
  }
};

export const storage = {
  getUsers: (): LocalUser[] => readJson<LocalUser[]>(USERS_KEY, []),
  setUsers: (users: LocalUser[]) => writeJson(USERS_KEY, users),

  getSessionUserId: (): string | null => localStorage.getItem(SESSION_KEY),
  setSessionUserId: (userId: string) => localStorage.setItem(SESSION_KEY, userId),
  clearSessionUserId: () => localStorage.removeItem(SESSION_KEY),

  getCurrentUser: (): LocalUser | null => {
    const direct = readJson<LocalUser | null>(CURRENT_USER_KEY, null);
    if (direct) return direct;

    // Compatibility with older local-only auth model.
    const sessionUserId = localStorage.getItem(SESSION_KEY);
    if (!sessionUserId) return null;
    const users = readJson<LocalUser[]>(USERS_KEY, []);
    return users.find((item) => item.id === sessionUserId) || null;
  },
  setCurrentUser: (user: LocalUser) => writeJson(CURRENT_USER_KEY, user),
  clearCurrentUser: () => localStorage.removeItem(CURRENT_USER_KEY),

  getProfile: (userId: string): LocalProfile => {
    const profile = readJson<LocalProfile | null>(profileKey(userId), null);
    if (profile) return profile;

    const legacySettings = readJson<Settings | null>(LEGACY_SETTINGS_KEY, null);
    const onboardingComplete = localStorage.getItem(LEGACY_PROFILE_KEY) === 'true';

    return {
      settings: legacySettings || defaultSettings(),
      onboarding_complete: onboardingComplete,
      updated_at: new Date().toISOString(),
    };
  },
  setProfile: (userId: string, profile: LocalProfile) => writeJson(profileKey(userId), profile),

  getTasks: (userId: string): Task[] => {
    migrateLegacyTasks(userId);
    return readJson<Task[]>(tasksKey(userId), []);
  },
  setTasks: (userId: string, tasks: Task[]) => writeJson(tasksKey(userId), tasks),

  getThreads: (userId: string): Thread[] => {
    migrateLegacyThreads(userId);
    return readJson<Thread[]>(threadsKey(userId), []);
  },
  setThreads: (userId: string, threads: Thread[]) => writeJson(threadsKey(userId), threads),

  clearUserData: (userId: string) => {
    localStorage.removeItem(profileKey(userId));
    localStorage.removeItem(tasksKey(userId));
    localStorage.removeItem(threadsKey(userId));
  },

  getDefaultSettings: defaultSettings,
};
