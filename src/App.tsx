/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { storage } from './lib/storage';
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

  useEffect(() => {
    setTasks(storage.getTasks());
    setThreads(storage.getThreads());
    setSettings(storage.getSettings());
    if (storage.getOnboardingComplete()) {
      setScreen('dash');
    }
  }, []);

  const updateTasks = (newTasks: Task[] | ((prev: Task[]) => Task[])) => {
    setTasks(prev => {
      const updated = typeof newTasks === 'function' ? newTasks(prev) : newTasks;
      storage.setTasks(updated);
      return updated;
    });
  };

  const updateThreads = (newThreads: Thread[] | ((prev: Thread[]) => Thread[])) => {
    setThreads(prev => {
      const updated = typeof newThreads === 'function' ? newThreads(prev) : newThreads;
      storage.setThreads(updated);
      return updated;
    });
  };

  const updateSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    storage.setSettings(newSettings);
  };

  const handleOnboardingComplete = () => {
    storage.setOnboardingComplete(true);
    setScreen('dash');
  };

  const startNewThread = () => {
    const newTh: Thread = {
      id: Date.now().toString(),
      title: 'Новая мысль',
      preview: '',
      messages: [],
      createdAt: Date.now()
    };
    const updated = [newTh, ...threads];
    updateThreads(updated);
    setCurTh(newTh.id);
    setScreen('ai');
  };

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
