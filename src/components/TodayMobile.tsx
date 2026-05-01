import React, { useState, useRef } from 'react';
import { Settings, ChevronLeft, ChevronUp, ArrowUp, Plus, Mic } from 'lucide-react';
import { motion } from 'motion/react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import { db } from '../lib/db';

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

export default function TodayMobile({ tasks, setTasks, onNavigate, onNewThreadWithMessage, onOpenThread }: TodayMobileProps) {
  const [input, setInput] = useState('');
  const touchStartX = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (dx > 60) onNavigate('dash');
  };

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

        <span style={{ fontFamily: F, fontSize: 18, color: 'rgba(34,34,36,0.5)', letterSpacing: '0em' }}>
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

      {hasTasks ? (
        /* ── Tasks mode: full-bleed rounded-top cards ── */
        <>
          <div style={{
            background: '#ffffff',
            borderRadius: '24px 24px 0 0',
            maxHeight: '48vh',
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronUp size={14} strokeWidth={1.75} color="rgba(34,34,36,0.4)" />
                <span style={{ fontFamily: M, fontSize: 14, color: 'rgba(34,34,36,0.5)' }}>
                  Ещё {todayTasks.length} {todayTasks.length === 1 ? 'дело' : todayTasks.length < 5 ? 'дела' : 'дел'}
                </span>
              </div>
              <button
                onClick={() => onNavigate('dash')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              >
                <Plus size={20} strokeWidth={1.75} color="rgba(34,34,36,0.4)" />
              </button>
            </div>
            <div style={{ padding: '0 20px 8px' }}>
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
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: '20px 20px 0 0', padding: '16px 20px', flexShrink: 0, marginTop: 3 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Спроси у мысли..."
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontFamily: M, fontSize: 15, color: '#222224', marginBottom: 12, display: 'block' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Plus size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
              <motion.button whileTap={{ scale: 0.9 }} onClick={handleSubmit} style={{ width: 38, height: 38, borderRadius: '50%', background: input.trim() ? '#111' : 'rgba(34,34,36,0.15)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}>
                <ArrowUp size={17} color="#fff" strokeWidth={2} />
              </motion.button>
            </div>
          </div>
          <div style={{ height: 'env(safe-area-inset-bottom, 0px)', background: '#f5f5f5', flexShrink: 0 }} />
        </>
      ) : (
        /* ── Empty mode: desktop-style floating cards at the bottom ── */
        <div style={{ padding: '0 16px', paddingBottom: 'max(100px, calc(env(safe-area-inset-bottom, 0px) + 100px))', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Tasks card */}
          <motion.div
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate('dash')}
            style={{
              background: '#ffffff',
              borderRadius: 18,
              padding: '16px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ChevronUp size={15} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
              <span style={{ fontFamily: M, fontSize: 15, color: 'rgba(34,34,36,0.4)' }}>
                Нет дел на сегодня
              </span>
            </div>
            <Plus size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
          </motion.div>

          {/* Chat input card */}
          <div style={{ background: '#ffffff', borderRadius: 18, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Plus size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" style={{ flexShrink: 0 }} />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="Спроси у мысли..."
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: M, fontSize: 15, color: '#222224' }}
              />
              {input.trim() ? (
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleSubmit} style={{ width: 34, height: 34, borderRadius: '50%', background: '#111', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.2s' }}>
                  <ArrowUp size={16} color="#fff" strokeWidth={2} />
                </motion.button>
              ) : (
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0 }}>
                  <Mic size={18} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
