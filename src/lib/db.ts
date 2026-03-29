import { supabase, getTelegramUser, isSupabaseConfigured, isInTelegram } from './supabase';
import { Task, Thread, Settings } from '../types';
import { storage } from './storage';

/**
 * DATABASE SCHEMA (SQL):
 * 
 * -- Profiles table
 * create table profiles (
 *   id bigint primary key, -- Telegram user ID
 *   settings jsonb default '{"agent":true,"confirm":true,"notifs":true}',
 *   onboarding_complete boolean default false,
 *   updated_at timestamp with time zone default now()
 * );
 * 
 * -- Threads table
 * create table threads (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id bigint references profiles(id) on delete cascade,
 *   title text,
 *   preview text,
 *   messages jsonb default '[]',
 *   created_at timestamp with time zone default now()
 * );
 * 
 * -- Tasks table
 * create table tasks (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id bigint references profiles(id) on delete cascade,
 *   name text,
 *   time text,
 *   date text,
 *   done boolean default false,
 *   type text default 'regular',
 *   subtasks jsonb default '[]',
 *   created_at timestamp with time zone default now()
 * );
 */

const getUserId = () => getTelegramUser()?.id;

export const db = {
  getUserId: () => getTelegramUser()?.id,
  isInTelegram: () => isInTelegram(),
  // Profiles & Settings
  getProfile: async () => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      return {
        settings: storage.getSettings(),
        onboarding_complete: storage.getOnboardingComplete()
      };
    }
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching profile:', error);
    }
    return data;
  },
  
  upsertProfile: async (onboardingComplete: boolean, settings: Settings) => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      storage.setOnboardingComplete(onboardingComplete);
      storage.setSettings(settings);
      return;
    }
    
    const { error } = await supabase
      .from('profiles')
      .upsert({ 
        id: userId, 
        onboarding_complete: onboardingComplete, 
        settings,
        updated_at: new Date().toISOString()
      });
      
    if (error) console.error('Error upserting profile:', error);
  },

  // Threads
  getThreads: async (): Promise<Thread[]> => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      return storage.getThreads();
    }
    
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching threads:', error);
      return [];
    }
    
    return data.map(t => ({
      id: t.id,
      title: t.title,
      preview: t.preview,
      messages: t.messages,
      createdAt: new Date(t.created_at).getTime()
    }));
  },
  
  saveThread: async (thread: Thread) => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      const threads = storage.getThreads();
      const index = threads.findIndex(t => t.id === thread.id);
      if (index >= 0) {
        threads[index] = thread;
      } else {
        threads.unshift(thread);
      }
      storage.setThreads(threads);
      return;
    }
    
    const { error } = await supabase
      .from('threads')
      .upsert({
        id: thread.id.includes('.') ? undefined : thread.id, // Handle potential non-uuid IDs from local storage
        user_id: userId,
        title: thread.title,
        preview: thread.preview,
        messages: thread.messages,
        created_at: new Date(thread.createdAt).toISOString()
      });
      
    if (error) console.error('Error saving thread:', error);
  },
  
  deleteThread: async (id: string) => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      const threads = storage.getThreads().filter(t => t.id !== id);
      storage.setThreads(threads);
      return;
    }
    
    const { error } = await supabase
      .from('threads')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
      
    if (error) console.error('Error deleting thread:', error);
  },

  // Tasks
  getTasks: async (): Promise<Task[]> => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      return storage.getTasks();
    }
    
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching tasks:', error);
      return [];
    }
    
    return data.map(t => ({
      id: t.id,
      name: t.name,
      time: t.time,
      date: t.date,
      done: t.done,
      type: t.type,
      subtasks: t.subtasks
    }));
  },
  
  saveTask: async (task: Task) => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      const tasks = storage.getTasks();
      const index = tasks.findIndex(t => t.id === task.id);
      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.unshift(task);
      }
      storage.setTasks(tasks);
      return;
    }
    
    const { error } = await supabase
      .from('tasks')
      .upsert({
        id: task.id.includes('.') ? undefined : task.id,
        user_id: userId,
        name: task.name,
        time: task.time,
        date: task.date,
        done: task.done,
        type: task.type,
        subtasks: task.subtasks
      });
      
    if (error) console.error('Error saving task:', error);
  },
  
  deleteTask: async (id: string) => {
    const userId = getUserId();
    if (!isSupabaseConfigured() || !userId) {
      const tasks = storage.getTasks().filter(t => t.id !== id);
      storage.setTasks(tasks);
      return;
    }
    
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
      
    if (error) console.error('Error deleting task:', error);
  }
};
