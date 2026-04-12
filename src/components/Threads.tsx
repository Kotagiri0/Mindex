import React, { useState } from 'react';
import { Search, Trash2, ChevronRight } from 'lucide-react';
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

export default function Threads({ threads, setThreads, onNavigate, onOpenThread, onNewThread }: ThreadsProps) {
  const [search, setSearch] = useState('');

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
    <div className="flex flex-col h-full bg-bg transition-theme">
      <div className="safe-top flex-shrink-0" />
      
      <div className="p-[20px_20px_12px] flex-shrink-0">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-[52px] bg-surface2 rounded-full flex items-center px-6 gap-3 border border-border transition-colors"
        >
          <Search size={18} className="text-text-tertiary" strokeWidth={2} />
          <input
            className="flex-1 bg-transparent border-none outline-none font-sans text-[17px] text-text-primary placeholder:text-text-tertiary transition-colors"
            placeholder="Поиск по твоим мыслям..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </motion.div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0">
        <div className="px-5 pb-32 flex flex-col">
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-text-tertiary py-12 px-4 text-[16px]"
            >
              Нет мыслей. Начни новую!
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {filtered.map((th, idx) => (
                <motion.div
                  key={th.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => onOpenThread(th.id)}
                  className="group py-5 flex items-center cursor-pointer active:opacity-60 transition-opacity border-b border-border last:border-none hover:bg-surface2/50 rounded-lg px-2 -mx-2"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="text-[19px] font-bold text-text-primary mb-1 truncate">
                      {th.title}
                    </div>
                    <div className="text-[15px] text-text-secondary leading-[1.4] line-clamp-2">
                      {th.preview || 'Нет сообщений'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => deleteThread(e, th.id)}
                      className="p-2 -m-2 text-text-tertiary hover:text-danger transition-colors"
                    >
                      <Trash2 size={18} />
                    </motion.button>
                    <ChevronRight size={22} className="text-text-tertiary flex-shrink-0" />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
