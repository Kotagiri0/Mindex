/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { getCurrentUser, logoutLocalUser } from './lib/auth';
import { Screen, Task, Thread, Settings, LocalUser } from './types';
import { uuid } from './lib/utils';
import LocalAuth from './components/LocalAuth';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import AIChat from './components/AIChat';
import Threads from './components/Threads';
import SettingsScreen from './components/Settings';
import BottomNav from './components/BottomNav';

const defaultSettings = { agent: true, confirm: true, notifs: true };

export default function App() {
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(getCurrentUser());
  const [screen, setScreen] = useState<Screen>('ob');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [curTh, setCurTh] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(getCurrentUser()));
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setTasks([]);
      setThreads([]);
      setSettings(defaultSettings);
      setOnboardingComplete(false);
      setScreen('ob');
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const [profile, fetchedTasks, fetchedThreads] = await Promise.all([
          db.getProfile(),
          db.getTasks(),
          db.getThreads(),
        ]);

        if (cancelled) return;

        const profileSettings = profile?.settings || defaultSettings;
        setSettings(profileSettings);
        setOnboardingComplete(Boolean(profile?.onboarding_complete));
        setScreen(profile?.onboarding_complete ? 'dash' : 'ob');
        setTasks(fetchedTasks);
        setThreads(fetchedThreads);
      } catch (error) {
        console.error('Failed to initialize local data:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleAuthenticated = (user: LocalUser) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    logoutLocalUser();
    setCurrentUser(null);
    setTasks([]);
    setThreads([]);
    setSettings(defaultSettings);
    setScreen('ob');
    setCurTh(null);
    setOnboardingComplete(false);
  };

  const updateTasks = (newTasks: Task[] | ((prev: Task[]) => Task[])) => {
    setTasks((prev) => {
      const updated = typeof newTasks === 'function' ? newTasks(prev) : newTasks;
      return updated;
    });
  };

  const updateThreads = (newThreads: Thread[] | ((prev: Thread[]) => Thread[])) => {
    setThreads((prev) => {
      const updated = typeof newThreads === 'function' ? newThreads(prev) : newThreads;
      return updated;
    });
  };

  const updateSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    await db.upsertProfile(onboardingComplete, newSettings);
  };

  const handleOnboardingComplete = async () => {
    setOnboardingComplete(true);
    await db.upsertProfile(true, settings);
    setScreen('dash');
  };

  const startNewThread = async () => {
    const newTh: Thread = {
      id: uuid(),
      title: 'Новая мысль',
      preview: '',
      messages: [],
      createdAt: Date.now(),
    };
    const updated = [newTh, ...threads];
    setThreads(updated);
    await db.saveThread(newTh);
    setCurTh(newTh.id);
    setScreen('ai');
  };

  if (!currentUser) {
    return <LocalAuth onAuthenticated={handleAuthenticated} />;
  }

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
              onOpenThread={(id) => {
                setCurTh(id);
                setScreen('ai');
              }}
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
              onOpenThread={(id) => {
                setCurTh(id);
                setScreen('ai');
              }}
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
              onLogout={handleLogout}
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