import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, MessageSquare, Trash2 } from 'lucide-react';
import { Task } from '../types';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

interface TaskDetailPanelProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (id: string, name: string, time: string, date: string, description: string, location: string) => void;
  onDelete: (id: string) => void;
  onOpenThread?: (id: string) => void;
  onCreate?: (name: string, time: string, date: string, description: string, location: string) => void;
  initialDate?: string;
  isCreating?: boolean;
}

export default function TaskDetailPanel({ task, onClose, onUpdate, onDelete, onOpenThread, onCreate, initialDate, isCreating }: TaskDetailPanelProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => {
    if (isCreating) {
      setName('');
      setTime('');
      setDate(initialDate || '');
      setDescription('');
      setLocation('');
    } else if (task) {
      setName(task.name);
      setTime(task.time || '');
      setDate(task.date || '');
      setDescription(task.description || '');
      setLocation(task.location || '');
    }
  }, [task?.id, isCreating]);

  const handleUpdate = () => {
    if (!task || !name.trim()) return;
    onUpdate(task.id, name, time, date, description, location);
  };

  const handleCreate = () => {
    if (!name.trim() || !onCreate) return;
    onCreate(name, time, date, description, location);
    onClose();
  };

  const handleDelete = () => {
    if (!task) return;
    onDelete(task.id);
    onClose();
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: M,
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(34,34,36,0.35)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 40,
    background: '#f5f5f5',
    border: '1.5px solid transparent',
    borderRadius: 10,
    padding: '0 12px',
    fontFamily: M,
    fontSize: 14,
    color: '#222224',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
  };

  return (
    <AnimatePresence>
      {(task || isCreating) && (
        <motion.div
          key="task-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          style={{
            flexShrink: 0,
            height: '100%',
            background: '#ffffff',
            borderLeft: '1px solid rgba(0,0,0,0.06)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 0' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span style={{ fontFamily: M, fontSize: 15, fontWeight: 600, color: '#222224' }}>{isCreating ? 'Новая задача' : 'Задача'}</span>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'rgba(34,34,36,0.35)', borderRadius: 6 }}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {/* Name */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Название</label>
              <input
                className="task-panel-input"
                style={inputStyle}
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={handleUpdate}
                onKeyDown={e => e.key === 'Enter' && handleUpdate()}
              />
            </div>

            {/* Date + Time */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Дата</label>
                <input
                  type="date"
                  className="task-panel-input"
                  style={inputStyle}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  onBlur={handleUpdate}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Время</label>
                <input
                  type="time"
                  className="task-panel-input"
                  style={inputStyle}
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  onBlur={handleUpdate}
                />
              </div>
            </div>

            {/* Location */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Место</label>
              <input
                className="task-panel-input"
                style={inputStyle}
                placeholder="Адрес или название"
                value={location}
                onChange={e => setLocation(e.target.value)}
                onBlur={handleUpdate}
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Описание</label>
              <textarea
                className="task-panel-input"
                style={{ ...inputStyle, height: 'auto', minHeight: 80, padding: '10px 12px', resize: 'none', lineHeight: 1.55 }}
                placeholder="Заметки к задаче"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={handleUpdate}
              />
            </div>

            {/* Open in chat */}
            {task?.threadId && onOpenThread && (
              <button
                onClick={() => { onOpenThread(task.threadId!); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', height: 40, borderRadius: 10,
                  background: 'rgba(34,34,36,0.06)', border: 'none', cursor: 'pointer',
                  fontFamily: M, fontSize: 14, color: '#222224', paddingLeft: 12,
                  marginBottom: 20,
                }}
              >
                <MessageSquare size={15} strokeWidth={1.75} />
                Открыть в чате
              </button>
            )}
          </div>

          {/* Delete / Create */}
          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            {isCreating ? (
              <button
                onClick={handleCreate}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', height: 40, borderRadius: 10,
                  background: '#222224', border: 'none', cursor: 'pointer',
                  fontFamily: M, fontSize: 14, color: '#fff',
                }}
              >
                Создать задачу
              </button>
            ) : (
              <button
                onClick={handleDelete}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', height: 40, borderRadius: 10,
                  background: 'rgba(192,57,43,0.08)', border: 'none', cursor: 'pointer',
                  fontFamily: M, fontSize: 14, color: '#c0392b', paddingLeft: 12,
                }}
              >
                <Trash2 size={15} strokeWidth={1.75} />
                Удалить задачу
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
