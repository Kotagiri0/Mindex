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
import Calendar from './components/Calendar';
import BottomNav from './components/BottomNav';
import DesktopApp from './components/DesktopApp';
import TodayMobile from './components/TodayMobile';

const defaultSettings = { agent: true, confirm: true, notifs: true };

export default function App() {
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(getCurrentUser());
  const [screen, setScreen] = useState<Screen>(() => getCurrentUser() ? 'dash' : 'ob');
  const [tasks, setTasks] = useState<Task[]>([]);
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
        setScreen(profile?.onboarding_complete ? 'today' : 'ob');
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
    setScreen('today');
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
    <div className="safe-area-container relative w-full h-screen overflow-hidden bg-bg">
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
                if (th && th.messages.filter(m => m.role === 'user').length === 0) {
                  setThreads(prev => prev.filter(t => t.id !== curTh));
                  db.deleteThread(curTh!);
                }
                navigateMobile('threads');
              }}
              onNavigate={navigateMobile}
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
