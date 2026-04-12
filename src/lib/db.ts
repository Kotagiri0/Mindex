import { Task, Thread, Settings, LocalProfile } from '../types';
import { getCurrentUser } from './auth';
import { storage } from './storage';

const getUserId = () => getCurrentUser()?.id;

const defaultProfile = (): LocalProfile => ({
  settings: storage.getDefaultSettings(),
  onboarding_complete: false,
  updated_at: new Date().toISOString(),
});

export const db = {
  getUserId: () => getCurrentUser()?.id,
  getProfile: async () => {
    const userId = db.getUserId();
    if (!userId) {
      return defaultProfile();
    }

    return storage.getProfile(userId);
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
  },

  getThreads: async (): Promise<Thread[]> => {
    const userId = getUserId();
    if (!userId) return [];

    return storage.getThreads(userId).sort((a, b) => b.createdAt - a.createdAt);
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
  },
  
  deleteThread: async (id: string) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const threads = storage.getThreads(userId).filter((t) => t.id !== id);
    storage.setThreads(userId, threads);
  },

  getTasks: async (): Promise<Task[]> => {
    const userId = getUserId();
    if (!userId) return [];

    return storage.getTasks(userId);
  },
  
  saveTask: async (task: Task) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const tasks = storage.getTasks(userId);
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) tasks[index] = task;
    else tasks.unshift(task);
    storage.setTasks(userId, tasks);
  },
  
  deleteTask: async (id: string) => {
    const userId = getUserId();
    if (!userId) {
      return;
    }

    const tasks = storage.getTasks(userId).filter((task) => task.id !== id);
    storage.setTasks(userId, tasks);
  }
};
