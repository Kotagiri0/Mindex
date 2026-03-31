import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export let supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export const initSupabase = (url: string, key: string) => {
  if (url && key) {
    supabaseUrl = url;
    supabaseAnonKey = key;
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    return true;
  }
  return false;
};

export const isSupabaseConfigured = () => {
  return (!!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY) || 
         (supabaseUrl !== 'https://placeholder-project.supabase.co' && supabaseAnonKey !== 'placeholder-key');
};

export const isInTelegram = () => {
  const tg = (window as any).Telegram?.WebApp;
  return !!tg?.initData;
};

export const getTelegramUser = () => {
  const tg = (window as any).Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user;
  
  // Fallback for development OR cases where Telegram is not yet initialized
  if (!user) {
    if (import.meta.env.DEV) {
      return { id: 12345678, first_name: 'Dev', last_name: 'User', username: 'devuser' };
    }
    return null;
  }
  
  return user;
};
