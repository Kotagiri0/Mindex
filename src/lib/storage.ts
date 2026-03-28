import { Task, Thread, Settings } from '../types';

export const storage = {
  getTasks: (): Task[] => JSON.parse(localStorage.getItem('mx_tasks') || '[]'),
  setTasks: (tasks: Task[]) => localStorage.setItem('mx_tasks', JSON.stringify(tasks)),
  
  getThreads: (): Thread[] => JSON.parse(localStorage.getItem('mx_threads') || '[]'),
  setThreads: (threads: Thread[]) => localStorage.setItem('mx_threads', JSON.stringify(threads)),
  
  getSettings: (): Settings => JSON.parse(localStorage.getItem('mx_settings') || '{"agent":true,"confirm":true,"notifs":true}'),
  setSettings: (settings: Settings) => localStorage.setItem('mx_settings', JSON.stringify(settings)),

  getOnboardingComplete: (): boolean => localStorage.getItem('mx_ob_complete') === 'true',
  setOnboardingComplete: (val: boolean) => localStorage.setItem('mx_ob_complete', val ? 'true' : 'false'),
};
