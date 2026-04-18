import React, { useState } from 'react';
import { Search, ChevronRight, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Thread, Screen } from '../types';
import { db } from '../lib/db';

interface ThreadsProps {
  threads: Thread[];
  setThreads: (threads: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  onNavigate: (screen: Screen) => void;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
}

const F = "'Random Grotesque', sans-serif";

export default function Threads({ threads, setThreads, onNavigate, onOpenThread }: ThreadsProps) {
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const filtered = threads.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase())
  );

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setThreads(prev => prev.filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#f0f0f0' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => { setShowSearch(v => !v); if (showSearch) setSearch(''); }}
          className="w-11 h-11 flex items-center justify-center"
        >
          <Search
            size={22}
            strokeWidth={1.75}
            color={showSearch ? '#222224' : 'rgba(34,34,36,0.45)'}
          />
        </motion.button>

        <span style={{ fontFamily: F, fontSize: '13px', letterSpacing: '0.18em', color: 'rgba(34,34,36,0.5)', textTransform: 'uppercase' }}>
          МЫСЛИ
        </span>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          className="w-11 h-11 flex items-center justify-center"
        >
          <Settings size={22} strokeWidth={1.75} color="rgba(34,34,36,0.5)" />
        </motion.button>
      </div>

      {/* Search bar (collapsible) */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 52, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden px-5 mb-1"
          >
            <div
              className="h-11 rounded-full flex items-center px-4 gap-2"
              style={{ background: '#ffffff', border: '1px solid rgba(34,34,36,0.1)' }}
            >
              <Search size={15} color="rgba(34,34,36,0.3)" />
              <input
                autoFocus
                className="flex-1 bg-transparent outline-none"
                style={{ fontFamily: F, fontSize: '15px', color: '#222224' }}
                placeholder="Поиск по мыслям..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ height: '1px', background: 'rgba(34,34,36,0.08)', margin: '0 20px' }} />

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-5 pb-20">
        {filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
            style={{ color: 'rgba(34,34,36,0.3)', fontFamily: F, fontSize: '15px' }}
          >
            Нет мыслей. Начни новую!
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((th, idx) => (
              <motion.div
                key={th.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: idx * 0.04 }}
                onClick={() => onOpenThread(th.id)}
                className="flex items-center py-4 cursor-pointer active:opacity-60 transition-opacity"
                style={{ borderBottom: '1px solid rgba(34,34,36,0.08)' }}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div style={{ fontFamily: F, fontSize: '17px', fontWeight: 600, color: '#222224', marginBottom: '3px' }}>
                    {th.title}
                  </div>
                  <div
                    className="line-clamp-2"
                    style={{ fontSize: '13px', color: 'rgba(34,34,36,0.45)', lineHeight: 1.45, fontFamily: F }}
                  >
                    {th.preview || 'Нет сообщений'}
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={1.75} color="rgba(34,34,36,0.3)" />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
