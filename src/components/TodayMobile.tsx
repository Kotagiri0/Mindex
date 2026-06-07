import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Loader } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Screen } from '../types';
import { db } from '../lib/db';
import { useVoiceInput } from '../lib/useVoiceInput';
import { SettingsIcon } from './icons';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";
const DAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface TodayMobileProps {
  tasks: Task[];
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void;
  onNavigate: (screen: Screen) => void;
  onNewThreadWithMessage: (msg: string) => void;
  onOpenThread: (id: string) => void;
}

export default function TodayMobile({ tasks, setTasks, onNavigate, onNewThreadWithMessage }: TodayMobileProps) {
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const touchStartX = useRef(0);
  const { state: voiceState, startRecording, stopRecording } = useVoiceInput((text: string) => {
    setInput(prev => prev ? prev + ' ' + text : text);
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const today = todayStr();
  const dayName = DAY_NAMES[new Date().getDay()];

  const todayTasks = tasks
    .filter(t => (t.date || today) === today && (!t.done || justDone.has(t.id)))
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (dx > 60) onNavigate('dash');
  };

  const toggleTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    const completing = task && !task.done;
    setTasks(tasks.map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
    if (completing) {
      setJustDone(prev => new Set(prev).add(id));
      setTimeout(() => {
        setJustDone(prev => { const s = new Set(prev); s.delete(id); return s; });
      }, 800);
    }
  };

  const handleSubmit = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    onNewThreadWithMessage(msg);
  };

  const hasTasks = todayTasks.length > 0;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', flexShrink: 0 }}>
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('dash')}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <ChevronLeft size={24} strokeWidth={1.75} color="rgba(11,13,16,0.45)" />
        </motion.button>

        <span style={{ fontFamily: F, fontSize: 18, color: 'rgba(11,13,16,0.75)' }}>
          {dayName}
        </span>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <SettingsIcon size={24} color="rgba(11,13,16,0.45)" />
        </motion.button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom card */}
      <div style={{ flexShrink: 0, background: '#ffffff', borderRadius: '28px 28px 0 0', overflow: 'hidden' }}>

        {/* Tasks section */}
        <AnimatePresence initial={false}>
          {hasTasks && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Collapse header */}
              <div
                onClick={() => setCollapsed(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px 12px', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <motion.div
                    animate={{ rotate: collapsed ? -90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronLeft
                      size={18}
                      strokeWidth={2}
                      color="rgba(11,13,16,0.4)"
                      style={{ transform: 'rotate(-90deg)' }}
                    />
                  </motion.div>
                  <span style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'rgba(11,13,16,0.5)' }}>
                    Ещё {todayTasks.length} {plural(todayTasks.length)}
                  </span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={e => { e.stopPropagation(); onNavigate('dash'); }}
                  style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <PlusIcon />
                </motion.button>
              </div>

              {/* Task list */}
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    style={{ maxHeight: '40vh', overflowY: 'auto' }}
                  >
                    {todayTasks.map(t => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={() => toggleTask(t.id)}
                        onClick={() => onNavigate('dash')}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Divider */}
              <div style={{ height: 1, background: 'rgba(11,13,16,0.06)', margin: '0 20px' }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat input */}
        <div style={{ padding: '16px 20px' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Есть мысли?"
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              fontFamily: M, fontSize: 15, color: '#0B0D10',
              marginBottom: 12, display: 'block', resize: 'none', lineHeight: 1.55,
              maxHeight: '120px', overflowY: 'auto',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Add task shortcut */}
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => onNavigate('dash')}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <PlusIcon size={22} color="rgba(11,13,16,0.35)" />
            </motion.button>

            {/* Send / Voice */}
            <AnimatePresence mode="wait">
              {input.trim() ? (
                <motion.button
                  key="send"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSubmit}
                  style={{
                    width: 36, height: 36, borderRadius: '50%', background: '#0B0D10',
                    border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <SendIcon />
                </motion.button>
              ) : (
                <motion.button
                  key="mic"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onPointerDown={startRecording}
                  onPointerUp={stopRecording}
                  onPointerCancel={stopRecording}
                  disabled={voiceState === 'processing'}
                  style={{
                    width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: voiceState === 'recording' ? '#c0392b' : 'rgba(11,13,16,0.08)',
                    transition: 'background 0.15s',
                  }}
                >
                  {voiceState === 'processing'
                    ? <Loader size={15} strokeWidth={2} color="#0B0D10" style={{ animation: 'spin 1s linear infinite' }} />
                    : <MicIcon color={voiceState === 'recording' ? '#fff' : 'rgba(11,13,16,0.4)'} />
                  }
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
      <div style={{ height: 'env(safe-area-inset-bottom, 0px)', background: '#ffffff', flexShrink: 0 }} />
    </div>
  );
}

// ─── Task Row ────────────────────────────────────────────────────────────────

function TaskRow({ task, onToggle, onClick }: { task: Task; onToggle: () => void; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', cursor: 'pointer' }}
    >
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={e => { e.stopPropagation(); onToggle(); }}
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 14,
          border: `1.5px solid ${task.done ? '#0B0D10' : 'rgba(11,13,16,0.22)'}`,
          background: task.done ? '#0B0D10' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', overflow: 'hidden',
        }}
      >
        {task.done && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.15 }}>
            <CheckIcon />
          </motion.div>
        )}
      </motion.button>

      <span style={{
        flex: 1, fontFamily: M, fontSize: 16, fontWeight: 400,
        color: task.done ? 'rgba(11,13,16,0.3)' : '#0B0D10',
        textDecoration: task.done ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.name}
      </span>

      {task.time && (
        <span style={{ fontFamily: M, fontSize: 14, color: 'rgba(11,13,16,0.35)', flexShrink: 0 }}>
          {task.time}
        </span>
      )}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PlusIcon({ size = 20, color = 'rgba(11,13,16,0.4)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function MicIcon({ color = 'rgba(11,13,16,0.4)' }: { color?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function plural(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'дело';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дела';
  return 'дел';
}
