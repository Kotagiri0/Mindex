/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { Screen, Task, Thread, Settings } from './types';
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

  useEffect(() => {
    // Telegram Mini App initialization
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#FFFFFF');
      
      // Trigger initialization by listening to viewport changes
      tg.onEvent('viewport_changed', () => {});
    }

    const initData = async () => {
      try {
        const [profile, fetchedTasks, fetchedThreads] = await Promise.all([
          db.getProfile(),
          db.getTasks(),
          db.getThreads()
        ]);

        const tgUser = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
        let currentSettings = profile?.settings || settings;
        let changed = false;

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
      id: crypto.randomUUID(),
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
