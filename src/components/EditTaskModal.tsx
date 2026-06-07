import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, TaskCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS, ORDERED_CATEGORIES } from '../lib/taskCategories';
import { useSquircle } from '../hooks/useSquircle';

import taskTimeIcon from '../assets/icons/task_time.svg';
import taskDateIcon from '../assets/icons/task_date.svg';
import taskPlaceIcon from '../assets/icons/task_place.svg';

export interface TaskEditPatch {
  name: string;
  time: string;
  endTime: string;
  date: string;
  description: string;
  location: string;
  category: TaskCategory;
  timeChangedByUser: boolean;
}

interface EditTaskModalProps {
  task: Task | null;
  isCreate?: boolean;
  initialDate?: string;
  onClose: () => void;
  onUpdate: (id: string, patch: TaskEditPatch) => void;
  onDelete: (id: string) => void;
  onOpenThread?: (id: string) => void;
}

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

export default function EditTaskModal({ task, isCreate, initialDate, onClose, onUpdate, onDelete }: EditTaskModalProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<TaskCategory>('none');
  const [initialTime, setInitialTime] = useState('');
  const [initialEnd, setInitialEnd] = useState('');
  const { ref: squircleRef, clipPath } = useSquircle({ cornerRadius: 36, cornerSmoothing: 0.6 });

  useEffect(() => {
    if (task) {
      setName(task.name);
      setTime(task.time || '');
      setEndTime(task.endTime || '');
      setDate(task.date || initialDate || '');
      setDescription(task.description || '');
      setLocation(task.location || '');
      setCategory(task.category || 'none');
      setInitialTime(task.time || '');
      setInitialEnd(task.endTime || '');
    } else if (isCreate) {
      setName(''); setTime(''); setEndTime('');
      setDate(initialDate || ''); setDescription(''); setLocation('');
      setCategory('none'); setInitialTime(''); setInitialEnd('');
    }
  }, [task, isCreate, initialDate]);

  const handleSave = () => {
    if (!task || !name.trim()) return;
    const timeChangedByUser = time !== initialTime || endTime !== initialEnd;
    onUpdate(task.id, { name, time, endTime, date, description, location, category, timeChangedByUser });
  };

  return (
    <AnimatePresence>
      {task && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end' }}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
          />
          <motion.div
            ref={squircleRef}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            style={{
              position: 'relative',
              width: '100%',
              background: '#ffffff',
              clipPath: clipPath || undefined,
              borderRadius: clipPath ? 0 : '36px 36px 0 0',
              padding: '18px 20px',
              paddingBottom: 'calc(32px + env(safe-area-inset-bottom, 0px))',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            {/* Drag handle */}
            <div style={{ width: 36, height: 4, background: 'rgba(34,34,36,0.12)', borderRadius: 2, margin: '0 auto 20px' }} />

            {/* Title */}
            <h3 style={{ fontFamily: M, fontSize: 20, fontWeight: 500, color: '#0B0D10', textAlign: 'center', marginBottom: 20 }}>
              Поменять
            </h3>

            {/* Name */}
            <FieldBox style={{ marginBottom: 8 }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Что на повестке дня?"
                style={inputStyle(!!name)}
              />
            </FieldBox>

            {/* Time row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
                <span style={valueStyle(!!time)}>{time || 'Начало'}</span>
                <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </FieldBox>
              <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
                <span style={valueStyle(!!endTime)}>{endTime || 'Конец'}</span>
                <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </FieldBox>
            </div>

            {/* Date */}
            <FieldBox style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
              <span style={valueStyle(!!date)}>{date ? formatDateRu(date) : 'В какой день?'}</span>
              <img src={taskDateIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
            </FieldBox>

            {/* Location */}
            <FieldBox style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Где будет проходить?"
                style={{ ...inputStyle(!!location), flex: 1 }}
              />
              <img src={taskPlaceIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
            </FieldBox>

            {/* Description */}
            <FieldBox style={{ marginBottom: 20 }}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Описание, если нужно подробнее"
                rows={3}
                style={{
                  width: '100%', border: 'none', outline: 'none', background: 'transparent',
                  fontFamily: M, fontSize: 15,
                  fontWeight: description ? 500 : 400,
                  color: description ? '#0B0D10' : 'rgba(11,13,16,0.3)',
                  resize: 'none', lineHeight: 1.5,
                }}
              />
            </FieldBox>

            {/* Category picker */}
            <CategoryPicker value={category} onChange={setCategory} />

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                onClick={() => onDelete(task.id)}
                style={{
                  flex: 1, height: 52, background: '#FFF0F0', color: '#E53935',
                  border: 'none', borderRadius: 999, fontFamily: M, fontSize: 16,
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                Убрать
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                style={{
                  flex: 2, height: 52,
                  background: name.trim() ? '#0B0D10' : 'rgba(11,13,16,0.18)',
                  color: '#ffffff', border: 'none', borderRadius: 999,
                  fontFamily: M, fontSize: 16, fontWeight: 700,
                  cursor: name.trim() ? 'pointer' : 'default',
                  transition: 'background 0.2s',
                }}
              >
                Сохранить
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ─── Category Picker ────────────────────────────────────────────────────────

const CIRCLE_H = 36;
const PILL_H = 52;

function CategoryPicker({ value, onChange }: { value: TaskCategory; onChange: (c: TaskCategory) => void }) {
  return (
    <div style={{
      background: '#f5f5f5',
      borderRadius: 18,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    }}>
      {ORDERED_CATEGORIES.map((cat) => {
        const c = CATEGORY_COLORS[cat];
        const active = value === cat;
        return (
          <motion.button
            key={cat}
            layout
            onClick={() => onChange(cat)}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            style={{
              background: c.bg,
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: 0,
            }}
            animate={{
              width: active ? 160 : CIRCLE_H,
              height: active ? PILL_H : CIRCLE_H,
            }}
          >
            <AnimatePresence mode="wait">
              {active ? (
                <motion.div
                  key="label"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 1, pointerEvents: 'none',
                  }}
                >
                  <span style={{
                    fontFamily: "'Helvetica Neue', Helvetica, sans-serif",
                    fontSize: 12,
                    fontWeight: 400,
                    color: c.textMuted,
                    letterSpacing: '0.01em',
                    lineHeight: 1.2,
                  }}>
                    категория
                  </span>
                  <span style={{
                    fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
                    fontSize: 16,
                    fontWeight: 500,
                    color: c.text,
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2,
                  }}>
                    {CATEGORY_LABELS[cat].toLowerCase()}
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="dot"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateRu(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

function FieldBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'relative',
      background: '#f5f5f5',
      borderRadius: 18,
      padding: '12px 16px',
      ...style,
    }}>
      {children}
    </div>
  );
}

const inputStyle = (hasValue: boolean): React.CSSProperties => ({
  width: '100%', border: 'none', outline: 'none', background: 'transparent',
  fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
  fontSize: 15,
  fontWeight: hasValue ? 500 : 400,
  color: hasValue ? '#0B0D10' : 'rgba(11,13,16,0.3)',
});

const valueStyle = (hasValue: boolean): React.CSSProperties => ({
  fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
  fontSize: 15,
  fontWeight: hasValue ? 500 : 400,
  color: hasValue ? '#0B0D10' : 'rgba(11,13,16,0.3)',
});
