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
  
  if (!user) {
    // Разрешаем fallback ID ТОЛЬКО для локальной разработки или превью в AI Studio
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isPreview = window.location.hostname.includes('.run.app');
    
    if (isLocal || isPreview) {
      return { 
        id: 'dev_user_777', 
        first_name: 'Preview', 
        last_name: 'User', 
        username: 'preview_user' 
      };
    }
    return null;
  }
  
  return {
    ...user,
    id: user.id.toString()
  };
};
