import React, { useState } from 'react';
import { Search, Settings, MoreVertical } from 'lucide-react';
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

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

export default function Threads({ threads, setThreads, onNavigate, onOpenThread }: ThreadsProps) {
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const filtered = threads.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase())
  );

  const deleteThread = async (id: string) => {
    setOpenDropdown(null);
    setThreads(prev => prev.filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px' }}>
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => { setShowSearch(v => !v); if (showSearch) setSearch(''); }}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Search size={24} strokeWidth={1.75} color="#111" />
        </motion.button>

        <span style={{ fontFamily: M, fontSize: 15, fontWeight: 500, letterSpacing: '0.1em', color: '#111', textTransform: 'uppercase' as const }}>
          МЫСЛИ
        </span>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Settings size={24} strokeWidth={1.75} color="#111" />
        </motion.button>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 52, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden', padding: '0 20px', marginBottom: 4 }}
          >
            <div style={{ height: 44, borderRadius: 999, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, background: '#ffffff', border: '1px solid rgba(34,34,36,0.1)' }}>
              <Search size={15} color="rgba(34,34,36,0.3)" />
              <input
                autoFocus
                style={{ flex: 1, background: 'transparent', outline: 'none', border: 'none', fontFamily: M, fontSize: 15, color: '#222224' }}
                placeholder="Поиск по мыслям..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ height: 1, background: 'rgba(34,34,36,0.08)', margin: '0 20px' }} />

      {/* Backdrop for dropdown */}
      {openDropdown && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          onClick={() => setOpenDropdown(null)}
        />
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
        {filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ textAlign: 'center', padding: '48px 20px', color: 'rgba(34,34,36,0.3)', fontFamily: F, fontSize: 15 }}
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
                onClick={() => { if (!openDropdown) onOpenThread(th.id); }}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <div style={{ fontFamily: M, fontSize: 17, fontWeight: 500, color: '#111', marginBottom: 3 }}>
                    {th.title}
                  </div>
                  <div style={{
                    fontSize: 14, color: '#aaa', fontWeight: 400, fontFamily: M,
                    lineHeight: 1.45, overflow: 'hidden',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {th.preview || 'Нет сообщений'}
                  </div>
                </div>

                {/* ⋮ button + dropdown */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    onClick={e => { e.stopPropagation(); setOpenDropdown(openDropdown === th.id ? null : th.id); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '4px 6px', display: 'flex', alignItems: 'center',
                    }}
                  >
                    <MoreVertical size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
                  </button>

                  <AnimatePresence>
                    {openDropdown === th.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 20,
                          background: '#fff', borderRadius: 10, padding: '4px 0',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                          minWidth: 120,
                        }}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); deleteThread(th.id); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '10px 16px', background: 'none', border: 'none',
                            cursor: 'pointer', fontFamily: M, fontSize: 14, color: '#e53e3e',
                          }}
                        >
                          Удалить
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
