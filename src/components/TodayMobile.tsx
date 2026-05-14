import React, { useState, useRef, useEffect } from 'react';
import { Settings, ChevronLeft, ArrowUp, Plus, Mic, Loader } from 'lucide-react';
import { motion } from 'motion/react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import { db } from '../lib/db';
import { useVoiceInput } from '../lib/useVoiceInput';

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
    .filter(t => (t.date || today) === today && !t.done)
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

  const toggleTask = async (id: string) => {
    setTasks(tasks.map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
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
          <ChevronLeft size={22} strokeWidth={1.75} color="rgba(34,34,36,0.5)" />
        </motion.button>

        <span style={{ fontFamily: F, fontSize: 18, color: 'rgba(34,34,36,0.75)', letterSpacing: '0em' }}>
          {dayName}
        </span>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Settings size={22} strokeWidth={1.75} color="rgba(34,34,36,0.5)" />
        </motion.button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom card — unified tasks + input */}
      <div style={{ flexShrink: 0, background: '#ffffff', borderRadius: '20px 20px 0 0' }}>

        {/* Tasks section */}
        {hasTasks && (
          <>
            <div style={{ maxHeight: '40vh', overflowY: 'auto', padding: '14px 20px 0' }}>
              {todayTasks.map(t => (
                <TaskItem
                  key={t.id}
                  task={t}
                  onToggle={() => toggleTask(t.id)}
                  onToggleSubtask={(taskId, subtaskId) => {
                    setTasks(tasks.map(task => {
                      if (task.id === taskId && task.subtasks) {
                        const u = { ...task, subtasks: task.subtasks.map(st => st.id === subtaskId ? { ...st, done: !st.done } : st) };
                        db.saveTask(u);
                        return u;
                      }
                      return task;
                    }));
                  }}
                  onClick={() => onNavigate('dash')}
                />
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', margin: '0' }} />
          </>
        )}

        {/* Chat input area */}
        <div style={{ padding: '14px 20px', background: hasTasks ? 'rgba(0,0,0,0.02)' : 'transparent' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Есть мысли?"
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              fontFamily: M, fontSize: 15, color: '#222224',
              marginBottom: 10, display: 'block', resize: 'none', lineHeight: 1.55,
              maxHeight: '120px', overflowY: 'auto',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <Plus size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
            </button>
            {input.trim() ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSubmit}
                style={{
                  width: 36, height: 36, borderRadius: '50%', background: '#111',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <ArrowUp size={16} color="#fff" strokeWidth={2} />
              </motion.button>
            ) : (
              <motion.button
                onPointerDown={e => { e.preventDefault(); startRecording(); }}
                onPointerUp={e => { e.preventDefault(); stopRecording(); }}
                onPointerCancel={stopRecording}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: voiceState === 'recording' ? '#c0392b' : 'rgba(34,34,36,0.1)',
                  transition: 'background 0.15s',
                }}
              >
                {voiceState === 'processing'
                  ? <Loader size={15} strokeWidth={2} color="#222224" className="animate-spin" />
                  : <Mic size={15} strokeWidth={1.75} color={voiceState === 'recording' ? '#fff' : 'rgba(34,34,36,0.35)'} />
                }
              </motion.button>
            )}
          </div>
        </div>

      </div>

      <div style={{ height: 'env(safe-area-inset-bottom, 0px)', background: '#ffffff', flexShrink: 0 }} />
    </div>
  );
}
