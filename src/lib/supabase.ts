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
  // platform is set synchronously by the SDK — unlike initData which can arrive late on Android
  return !!tg && tg.platform !== 'unknown';
};

export const getTelegramUser = () => {
  const tg = (window as any).Telegram?.WebApp;

  // Try initDataUnsafe first (normal case)
  let user = tg?.initDataUnsafe?.user;

  // Fallback: parse initData string manually.
  // Android Telegram sometimes doesn't populate initDataUnsafe.user
  // even though initData (raw URL-encoded string) contains the user object.
  if (!user && tg?.initData) {
    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get('user');
      if (userStr) {
        user = JSON.parse(decodeURIComponent(userStr));
      }
    } catch (e) {
      console.error('[Auth] Failed to parse initData manually:', e);
    }
  }

  if (!user) {
    // Fallback ONLY for local dev / preview environments
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
    id: Number(user.id)
  };
};
