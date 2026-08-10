import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Mic, Loader, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Screen } from '../types';
import { db } from '../lib/db';
import { useVoiceInput } from '../lib/useVoiceInput';
import { SettingsIcon } from './icons';

const M = "'Mulish', 'Helvetica Neue', Helvetica, sans-serif";
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

      {/* Task list — над карточкой, на сером фоне */}
      <div style={{ padding: '0 16px', flexShrink: 0, maxHeight: '45vh', overflowY: 'auto' }}>
        <AnimatePresence initial={false}>
          {todayTasks.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <TaskRow
                task={t}
                onToggle={() => toggleTask(t.id)}
                onClick={() => onNavigate('dash')}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input card — точная копия AIChat */}
      <div style={{ flexShrink: 0, padding: '8px 16px', paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ background: '#ffffff', borderRadius: 20, padding: 16 }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Есть мысли?"
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              fontFamily: M, fontSize: 15, color: '#222224',
              display: 'block', resize: 'none', lineHeight: 1.55,
              maxHeight: '120px', overflowY: 'auto',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
            <motion.button
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerCancel={stopRecording}
              disabled={voiceState === 'processing'}
              style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: voiceState === 'recording' ? '#c0392b' : voiceState === 'processing' ? 'rgba(34,34,36,0.15)' : 'rgba(34,34,36,0.08)',
                transition: 'background 0.15s',
              }}
            >
              {voiceState === 'processing'
                ? <Loader size={15} strokeWidth={2} color="#222224" className="animate-spin" />
                : <Mic size={15} strokeWidth={1.75} color={voiceState === 'recording' ? '#fff' : 'rgba(34,34,36,0.5)'} />
              }
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleSubmit}
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: input.trim() ? '#222224' : 'rgba(34,34,36,0.15)',
                transition: 'background 0.15s',
              }}
            >
              <ArrowUp size={20} strokeWidth={2} color="#ffffff" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Task Row ────────────────────────────────────────────────────────────────

function TaskRow({ task, onToggle, onClick }: { task: Task; onToggle: () => void; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', cursor: 'pointer' }}
    >
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={e => { e.stopPropagation(); onToggle(); }}
        style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: 13,
          border: `1.5px solid ${task.done ? '#222224' : 'rgba(34,34,36,0.25)'}`,
          background: task.done ? '#222224' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', overflow: 'hidden',
        }}
      >
        <AnimatePresence>
          {task.done && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.15 }}>
              <CheckIcon />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <span style={{
        flex: 1, fontFamily: M, fontSize: 15, fontWeight: 400,
        color: task.done ? 'rgba(34,34,36,0.35)' : '#222224',
        textDecoration: task.done ? 'line-through' : 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        transition: 'color 0.15s',
      }}>
        {task.name}
      </span>

      {task.scheduleId && <span title="Повторяется по расписанию" style={{ fontSize: 12, flexShrink: 0, opacity: 0.75 }}>🔁</span>}

      {task.time && (
        <span style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.4)', flexShrink: 0 }}>
          {task.time}{task.endTime ? ` – ${task.endTime}` : ''}
        </span>
      )}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
