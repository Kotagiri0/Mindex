/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { supabase, initSupabase, isSupabaseConfigured } from './lib/supabase';
import { Screen, Task, Thread, Settings } from './types';
import { uuid } from './lib/utils';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import AIChat from './components/AIChat';
import Threads from './components/Threads';
import SettingsScreen from './components/Settings';
import BottomNav from './components/BottomNav';

export default function App() {
  const [screen, setScreen] = useState<Screen>('ob');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<Settings>({ agent: true, confirm: true, notifs: true });
  const [curTh, setCurTh] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    // 1. Очистка устаревшего кэша ID, если он не совпадает с текущим TG ID
    const tg = (window as any).Telegram?.WebApp;
    const telegramId = tg?.initDataUnsafe?.user?.id;
    const storedId = localStorage.getItem('userId'); // Проверка на случай старых версий

    if (storedId && telegramId && String(storedId) !== String(telegramId)) {
      console.log('[Auth] ID mismatch detected, clearing cache');
      localStorage.clear(); // Полная очистка для безопасности
    }

    // Telegram Mini App initialization
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#FFFFFF');
      
      // Trigger initialization by listening to viewport changes
      tg.onEvent('viewport_changed', () => {});
    }

    const initData = async () => {
      try {
        // 1. Сначала пытаемся получить конфиг Supabase с сервера
        try {
          const configRes = await fetch('/api/config');
          if (configRes.ok) {
            const config = await configRes.json();
            if (config.supabaseUrl && config.supabaseAnonKey) {
              initSupabase(config.supabaseUrl, config.supabaseAnonKey);
            }
          }
        } catch (e) {
          console.error('[Sync] Error fetching dynamic config:', e);
        }

        // 2. Ждем, пока Telegram WebApp предоставит данные пользователя
        let userId = db.getUserId();
        let attempts = 0;
        const maxAttempts = 80; // 8 seconds — mobile Telegram WebView can be slow

        while (!userId && attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 100));
          userId = db.getUserId();
          attempts++;
        }

        if (!userId) {
          console.error(`[Auth] User ID not found after ${attempts} attempts. Host: ${window.location.hostname}`);
          setAuthError(true);
          setLoading(false);
          return;
        }

        console.log(`[Auth] User identified: ${userId} (after ${attempts} attempts)`);
        
        // Сохраняем текущий ID для будущих проверок (если нужно)
        localStorage.setItem('userId', userId);

        // 3. Теперь загружаем данные
        const [profile, fetchedTasks, fetchedThreads] = await Promise.all([
          db.getProfile(),
          db.getTasks(),
          db.getThreads()
        ]);

        const tgUser = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
        let currentSettings = profile?.settings || settings;
        let changed = false;

        // Автоматически устанавливаем email админа для вас
        if (!currentSettings.email && (tgUser?.username === 'vadimkosov' || !db.isInTelegram())) {
          currentSettings = { ...currentSettings, email: 'vadimkosov7@gmail.com' };
          changed = true;
        }

        if (tgUser) {
          if (!currentSettings.name) {
            currentSettings = { 
              ...currentSettings, 
              name: `${tgUser.first_name}${tgUser.last_name ? ' ' + tgUser.last_name : ''}`.trim() 
            };
            changed = true;
          }
          if (!currentSettings.avatar && tgUser.photo_url) {
            currentSettings = { ...currentSettings, avatar: tgUser.photo_url };
            changed = true;
          }
        }

        setSettings(currentSettings);
        if (changed) {
          db.upsertProfile(profile?.onboarding_complete || false, currentSettings);
        }

        if (profile?.onboarding_complete) {
          setScreen('dash');
        }
        setTasks(fetchedTasks);
        setThreads(fetchedThreads);
      } catch (error) {
        console.error('Failed to initialize data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Small delay ensures initDataUnsafe is populated
    const timer = setTimeout(() => {
      const userId = db.getUserId();
      if (db.isInTelegram() && !userId) {
        // If in Telegram but user not found yet, wait a bit longer
        setTimeout(initData, 200);
      } else {
        initData();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const userId = db.getUserId();
    if (!userId || !isSupabaseConfigured() || loading) return;

    const channel = supabase
      .channel('tasks-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newTask = payload.new as any;
          const task: Task = {
            id: newTask.id,
            name: newTask.name,
            time: newTask.time || '',
            date: newTask.date,
            done: newTask.done,
            type: newTask.type || 'regular'
          };
          
          setTasks((prev) => {
            if (prev.some(t => t.id === task.id)) return prev;
            return [task, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loading]);

  const updateTasks = (newTasks: Task[] | ((prev: Task[]) => Task[])) => {
    setTasks(prev => {
      const updated = typeof newTasks === 'function' ? newTasks(prev) : newTasks;
      // We don't await here to keep UI snappy, but we should handle errors in db.ts
      // For a more robust app, we'd use a sync queue or optimistic updates with rollback
      return updated;
    });
  };

  const updateThreads = (newThreads: Thread[] | ((prev: Thread[]) => Thread[])) => {
    setThreads(prev => {
      const updated = typeof newThreads === 'function' ? newThreads(prev) : newThreads;
      return updated;
    });
  };

  const updateSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    await db.upsertProfile(true, newSettings);
  };

  const handleOnboardingComplete = async () => {
    await db.upsertProfile(true, settings);
    setScreen('dash');
  };

  const startNewThread = async () => {
    const newTh: Thread = {
      id: uuid(),
      title: 'Новая мысль',
      preview: '',
      messages: [],
      createdAt: Date.now()
    };
    const updated = [newTh, ...threads];
    setThreads(updated);
    await db.saveThread(newTh);
    setCurTh(newTh.id);
    setScreen('ai');
  };

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-bg">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-bg p-6 text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent text-2xl">
          ✈️
        </div>
        <h1 className="text-xl font-bold text-ink">Открой в Telegram</h1>
        <p className="text-ink/60 text-sm max-w-xs">
          Мысль работает только внутри Telegram.<br/>
          Найди бота и открой приложение через кнопку в чате.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium"
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-bg">
      <AnimatePresence mode="wait">
        {screen === 'ob' && (
          <motion.div
            key="ob"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <Onboarding onComplete={handleOnboardingComplete} />
          </motion.div>
        )}

        {screen === 'dash' && (
          <motion.div
            key="dash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <Dashboard 
              tasks={tasks} 
              setTasks={updateTasks} 
              onNavigate={setScreen} 
              onNewThread={startNewThread}
              onOpenThread={(id) => { setCurTh(id); setScreen('ai'); }}
            />
          </motion.div>
        )}

        {screen === 'ai' && (
          <motion.div
            key="ai"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0"
          >
            <AIChat 
              threadId={curTh} 
              threads={threads} 
              setThreads={updateThreads} 
              tasks={tasks}
              setTasks={updateTasks}
              onClose={() => setScreen('threads')}
              onNavigate={setScreen}
            />
          </motion.div>
        )}

        {screen === 'threads' && (
          <motion.div
            key="threads"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <Threads 
              threads={threads} 
              setThreads={updateThreads} 
              onNavigate={setScreen} 
              onOpenThread={(id) => { setCurTh(id); setScreen('ai'); }}
              onNewThread={startNewThread}
            />
          </motion.div>
        )}

        {screen === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute inset-0"
          >
            <SettingsScreen 
              settings={settings} 
              setSettings={updateSettings} 
              onBack={() => setScreen('dash')} 
            />
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav 
        activeScreen={screen} 
        onNavigate={setScreen} 
        onNewThread={startNewThread} 
      />
    </div>
  );
}
