/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { getCurrentUser, logoutLocalUser } from './lib/auth';
import { storage } from './lib/storage';
import { Screen, Task, Thread, Settings, LocalUser } from './types';
import { uuid } from './lib/utils';
import { sortTasks } from './lib/sortTasks';
import LocalAuth from './components/LocalAuth';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import AIChat from './components/AIChat';
import Threads from './components/Threads';
import SettingsScreen from './components/Settings';
import Calendar from './components/Calendar';
import BottomNav from './components/BottomNav';
import DesktopApp from './components/DesktopApp';
import TodayMobile from './components/TodayMobile';

const defaultSettings = { agent: true, confirm: true, notifs: true };
const TASK_REFRESH_INTERVAL_MS = 60_000;

export default function App() {
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(getCurrentUser());
  const [screen, setScreen] = useState<Screen>(() => getCurrentUser() ? 'dash' : 'ob');
  const [tasks, setTasksRaw] = useState<Task[]>([]);
  const setTasks = useCallback((arg: Task[] | ((prev: Task[]) => Task[])) => {
    setTasksRaw(prev => {
      const next = typeof arg === 'function' ? arg(prev) : arg;
      return sortTasks(next);
    });
  }, []);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [curTh, setCurTh] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(getCurrentUser()));
  const [pendingMsg, setPendingMsg] = useState('');
  const [threadsSubScreen, setThreadsSubScreen] = useState(false);

  const navigateMobile = (next: Screen) => { setScreen(next); if (next !== 'threads') setThreadsSubScreen(false); };
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktopViewport(event.matches);
    };

    setIsDesktopViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleViewportChange);

    return () => {
      mediaQuery.removeEventListener('change', handleViewportChange);
    };
  }, []);

  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);

    // Тихая миграция: если пользователь есть но токена нет — получаем токен без повторного логина
    if (user && !storage.getSessionToken()) {
      fetch('/api/auth/migrate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
        .then(r => r.json())
        .then(d => { if (d.token) storage.setSessionToken(d.token); })
        .catch(() => {});
    }

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

    let refreshInFlight = false;
    let intervalId: number | null = null;

    const refreshTasks = async (source: 'interval' | 'visibility') => {
      if (cancelled || refreshInFlight) return;
      if (source === 'interval' && document.visibilityState !== 'visible') return;
      refreshInFlight = true;
      try {
        const fresh = await db.refreshTasks();
        if (!cancelled) setTasks(fresh);
      } catch (error) {
        console.warn('Failed to refresh tasks:', error);
      } finally {
        refreshInFlight = false;
      }
    };

    const startInterval = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        refreshTasks('interval');
      }, TASK_REFRESH_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startInterval();
        refreshTasks('visibility');
        return;
      }
      stopInterval();
    };

    handleVisibilityChange();
    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      stopInterval();
      window.removeEventListener('visibilitychange', handleVisibilityChange);
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
      return [...updated].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    });
  };

  const updateSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    await db.upsertProfile(onboardingComplete, newSettings);
  };

  const handleOnboardingComplete = async (threadId?: string) => {
    setOnboardingComplete(true);
    await db.upsertProfile(true, settings);
    if (threadId) {
      const freshThreads = await db.getThreads();
      setThreads(freshThreads);
      setCurTh(threadId);
      setScreen('ai');
    } else {
      setScreen(isDesktopViewport ? 'dash' : 'today');
    }
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

  const startNewThreadWithMessage = async (msg: string) => {
    const newTh: Thread = {
      id: uuid(),
      title: 'Новая мысль',
      preview: msg.length > 60 ? msg.slice(0, 60) + '…' : msg,
      messages: [],
      createdAt: Date.now(),
    };
    setThreads(prev => [newTh, ...prev]);
    await db.saveThread(newTh);
    setCurTh(newTh.id);
    setPendingMsg(msg);
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

  if (isDesktopViewport) {
    return (
      <DesktopApp
        tasks={tasks}
        setTasks={updateTasks}
        threads={threads}
        setThreads={updateThreads}
        settings={settings}
        setSettings={updateSettings}
        screen={screen}
        setScreen={setScreen}
        curTh={curTh}
        setCurTh={setCurTh}
        startNewThread={startNewThread}
        handleLogout={handleLogout}
      />
    );
  }

  return (
    <div className="safe-area-container relative w-full overflow-hidden bg-bg" style={{ height: '100dvh' }}>
      <AnimatePresence mode="wait">
        {screen === 'today' && (
          <motion.div
            key="today"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
          >
            <TodayMobile
              tasks={tasks}
              setTasks={updateTasks}
              onNavigate={navigateMobile}
              onNewThreadWithMessage={startNewThreadWithMessage}
              onOpenThread={(id) => { setCurTh(id); setScreen('ai'); }}
            />
          </motion.div>
        )}

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
              onNavigate={navigateMobile}
              onNewThread={startNewThread}
              onLogout={handleLogout}
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
              onClose={() => {
                const th = threads.find(t => t.id === curTh);
                const hasLinkedTask = tasks.some(t => t.threadId === curTh);
                if (th && !hasLinkedTask && th.messages.filter(m => m.role === 'user').length === 0) {
                  setThreads(prev => prev.filter(t => t.id !== curTh));
                  db.deleteThread(curTh!);
                }
                navigateMobile('threads');
              }}
              onNavigate={navigateMobile}
              onOpenThread={(id) => { setCurTh(id); setScreen('ai'); }}
              autoSend={pendingMsg}
              onAutoSentClear={() => setPendingMsg('')}
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
              tasks={tasks}
              onNavigate={navigateMobile}
              onOpenThread={(id) => {
                setCurTh(id);
                setScreen('ai');
              }}
              onNewThread={startNewThread}
              onSubScreenChange={setThreadsSubScreen}
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
              onBack={() => navigateMobile('dash')}
              onLogout={handleLogout}
            />
          </motion.div>
        )}

        {screen === 'cal' && (
          <motion.div
            key="cal"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute inset-0"
          >
            <div className="w-full h-full bg-bg px-4 pt-3 pb-6 overflow-hidden">
              <Calendar onBack={() => setScreen('dash')} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!threadsSubScreen && (
        <BottomNav
          activeScreen={screen}
          onNavigate={navigateMobile}
          onNewThread={startNewThread}
        />
      )}
    </div>
  );
}
