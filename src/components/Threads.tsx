import React, { useState, useRef, useEffect } from 'react';
import { Search, Settings, MoreVertical, ChevronLeft, Plus, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Thread, Screen, Task } from '../types';
import { db } from '../lib/db';
import NoteView from './NoteView';
import NoteEditor from './NoteEditor';

interface ThreadsProps {
  threads: Thread[];
  setThreads: (threads: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  tasks: Task[];
  onNavigate: (screen: Screen) => void;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
}

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

export default function Threads({ threads, setThreads, tasks, onNavigate, onOpenThread }: ThreadsProps) {
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'thoughts' | 'notes'>('thoughts');
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const editingNote = editingNoteId ? threads.find(t => t.id === editingNoteId) : undefined;

  const handleNoteSaved = (saved: Thread) => {
    setThreads((prev: Thread[]) => {
      const exists = prev.some(t => t.id === saved.id);
      return exists ? prev.map(t => t.id === saved.id ? saved : t) : [saved, ...prev];
    });
    setShowNoteEditor(false);
    setEditingNoteId(null);
  };

  const openNoteEditor = (noteId?: string) => {
    setEditingNoteId(noteId || null);
    setShowNoteEditor(true);
  };

  const searchMatch = (t: Thread) =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase());

  const filtered = threads.filter(t =>
    t.source !== 'skill' &&
    (activeTab === 'thoughts' ? t.is_meaningful !== false : true) &&
    searchMatch(t)
  );

  const handleRename = async (id: string) => {
    const val = renameValue.trim();
    if (!val) { setRenamingId(null); return; }
    setThreads((prev: Thread[]) => prev.map(t => {
      if (t.id !== id) return t;
      const u = { ...t, title: val };
      db.saveThread(u);
      return u;
    }));
    setRenamingId(null);
  };

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingId]);

  const deleteThread = async (id: string) => {
    setOpenDropdown(null);
    setThreads((prev: Thread[]) => prev.filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  // ── Note editor ──────────────────────────────────────────────────────────────
  if (showNoteEditor) {
    return (
      <NoteEditor
        thread={editingNote}
        onSaved={handleNoteSaved}
        onClose={() => { setShowNoteEditor(false); setEditingNoteId(null); }}
      />
    );
  }

  // ── Note detail view ─────────────────────────────────────────────────────────
  if (activeTab === 'notes' && openNoteId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' }}>
        <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', flexShrink: 0 }}>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => setOpenNoteId(null)}
            style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <ChevronLeft size={22} strokeWidth={1.75} color="#222224" />
          </motion.button>
          <span style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: '#111' }}>Заметка</span>
          <div style={{ width: 44 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: '#fff', borderRadius: '20px 20px 0 0' }}>
          <NoteView
            threadId={openNoteId}
            threads={threads}
            setThreads={setThreads}
            tasks={tasks}
            onSwitchToChat={() => { onOpenThread(openNoteId); setOpenNoteId(null); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: activeTab === 'notes' ? '#ffffff' : '#f0f0f0' }}>
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

        {/* Tab slider */}
        <div style={{ display: 'flex', background: '#e8e8e8', borderRadius: 999, padding: 4, gap: 2 }}>
          {(['thoughts', 'notes'] as const).map(tab => (
            <motion.button
              key={tab}
              onClick={() => setActiveTab(tab)}
              whileTap={{ scale: 0.94 }}
              style={{ position: 'relative', padding: '6px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', background: 'transparent' }}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="threads-tab-indicator"
                  style={{ position: 'absolute', inset: 0, background: '#ffffff', borderRadius: 999 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1, fontFamily: F, fontSize: 14, color: activeTab === tab ? '#111' : 'rgba(34,34,36,0.45)', fontWeight: 400 }}>
                {tab === 'thoughts' ? 'Мысли' : 'Заметки'}
              </span>
            </motion.button>
          ))}
        </div>

        {activeTab === 'notes' ? (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => openNoteEditor()}
            style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Plus size={24} strokeWidth={1.75} color="#111" />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => onNavigate('settings')}
            style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Settings size={24} strokeWidth={1.75} color="#111" />
          </motion.button>
        )}
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
                placeholder={activeTab === 'thoughts' ? 'Поиск по мыслям...' : 'Поиск по заметкам...'}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', margin: '0 20px' }} />

      {/* Backdrop for dropdown */}
      {openDropdown && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpenDropdown(null)} />
      )}

      {/* ── Notes grid ─────────────────────────────────────────────────────────── */}
      {activeTab === 'notes' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 80px' }}>
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ textAlign: 'center', padding: '48px 20px', color: 'rgba(34,34,36,0.3)', fontFamily: F, fontSize: 15 }}
            >
              Нет заметок. Начни мысль или нажми +
            </motion.div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {filtered.map(th => {
                const dateStr = new Date(th.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                return (
                  <motion.div
                    key={th.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      if (th.source === 'заметка') {
                        openNoteEditor(th.id);
                      } else {
                        setOpenNoteId(th.id);
                      }
                    }}
                    style={{
                      background: '#ffffff', borderRadius: 16, padding: '14px 14px 12px',
                      cursor: 'pointer', minHeight: 100,
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}
                  >
                    <div style={{ fontFamily: M, fontSize: 13, fontWeight: 500, color: '#111', lineHeight: 1.35,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                      {th.title}
                    </div>
                    {th.preview && (
                      <div style={{ fontFamily: M, fontSize: 12, color: 'rgba(34,34,36,0.4)', lineHeight: 1.4, flex: 1,
                        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const }}>
                        {th.preview}
                      </div>
                    )}
                    <div style={{ fontFamily: M, fontSize: 11, color: 'rgba(34,34,36,0.3)', marginTop: 'auto' }}>
                      {dateStr}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Thoughts list ───────────────────────────────────────────────────────── */}
      {activeTab === 'thoughts' && (
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
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
                  onClick={() => { if (!openDropdown && renamingId !== th.id) onOpenThread(th.id); }}
                  style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                    {renamingId === th.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(th.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(th.id); if (e.key === 'Escape') setRenamingId(null); }}
                        onClick={e => e.stopPropagation()}
                        style={{ fontFamily: M, fontSize: 16, fontWeight: 500, color: '#111', background: 'transparent', border: 'none', outline: 'none', borderBottom: '1px solid rgba(0,0,0,0.2)', width: '100%', marginBottom: 3 }}
                      />
                    ) : (
                    <div style={{ fontFamily: M, fontSize: 16, fontWeight: 500, color: '#111', marginBottom: 3 }}>
                      {th.title}
                    </div>
                    )}
                    <div style={{
                      fontSize: 13, color: '#aaa', fontWeight: 400, fontFamily: M,
                      lineHeight: 1.45, overflow: 'hidden',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {th.preview || 'Нет сообщений'}
                    </div>
                  </div>

                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setOpenDropdown(openDropdown === th.id ? null : th.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center' }}
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
                            boxShadow: '0 4px 20px rgba(0,0,0,0.12)', minWidth: 140,
                          }}
                        >
                          <button
                            onClick={e => { e.stopPropagation(); setOpenDropdown(null); setRenameValue(th.title); setRenamingId(th.id); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                              padding: '10px 16px', background: 'none', border: 'none',
                              cursor: 'pointer', fontFamily: M, fontSize: 14, color: '#111',
                            }}
                          >
                            <Pencil size={13} strokeWidth={1.75} />
                            Переименовать
                          </button>
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
      )}
    </div>
  );
}
