import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Check } from 'lucide-react';
import { Task, TaskCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS, ORDERED_CATEGORIES } from '../lib/taskCategories';

export interface TaskEditPatch {
  name: string;
  time: string;
  endTime: string;
  date: string;
  description: string;
  location: string;
  category: TaskCategory;
  /** true — пользователь менял время руками → timeSource станет 'user'. */
  timeChangedByUser: boolean;
}

interface EditTaskModalProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (id: string, patch: TaskEditPatch) => void;
  onDelete: (id: string) => void;
  onOpenThread?: (id: string) => void;
}

export default function EditTaskModal({ task, onClose, onUpdate, onDelete, onOpenThread }: EditTaskModalProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<TaskCategory>('none');
  // Запоминаем исходное время, чтобы понять, менял ли пользователь его руками.
  const [initialTime, setInitialTime] = useState('');
  const [initialEnd, setInitialEnd] = useState('');

  useEffect(() => {
    if (task) {
      setName(task.name);
      setTime(task.time || '');
      setEndTime(task.endTime || '');
      setDate(task.date || '');
      setDescription(task.description || '');
      setLocation(task.location || '');
      setCategory(task.category || 'none');
      setInitialTime(task.time || '');
      setInitialEnd(task.endTime || '');
    }
  }, [task]);

  const handleUpdate = () => {
    if (!task || !name.trim()) return;
    const timeChangedByUser = time !== initialTime || endTime !== initialEnd;
    onUpdate(task.id, { name, time, endTime, date, description, location, category, timeChangedByUser });
  };

  const handleGoToChat = () => {
    if (task?.threadId && onOpenThread) {
      onOpenThread(task.threadId);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {task && (
        <div className="fixed inset-0 z-[300] flex items-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative w-full bg-surface rounded-t-[22px] p-[18px_18px_calc(32px+env(safe-area-inset-bottom,0px))]"
          >
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
            
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-[17px] font-bold">Редактировать</h3>
              {task.threadId && (
                <button 
                  onClick={handleGoToChat}
                  className="flex items-center gap-1.5 text-accent text-[13px] font-bold bg-accent-light p-[6px_12px] rounded-full active:scale-95 transition-transform"
                >
                  <MessageSquare size={14} />
                  В чат
                </button>
              )}
            </div>
            
            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Название</label>
              <input
                className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex gap-2.5 mb-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Начало</label>
                <input
                  type="time"
                  className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Конец</label>
                <input
                  type="time"
                  className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary disabled:opacity-40"
                  value={endTime}
                  disabled={!time}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Дата</label>
              <input
                type="date"
                className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {/* Цветовой пикер категории — плашки-цвета, не названия */}
            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1.5 uppercase tracking-wider">Категория</label>
              <div className="flex gap-2.5">
                {ORDERED_CATEGORIES.map((cat) => {
                  const c = CATEGORY_COLORS[cat];
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-label={CATEGORY_LABELS[cat]}
                      aria-pressed={active}
                      onClick={() => setCategory(cat)}
                      className="flex items-center justify-center rounded-full transition-transform active:scale-90"
                      style={{
                        width: 38,
                        height: 38,
                        background: c.bg,
                        border: `1.5px solid ${active ? c.text : c.border}`,
                        boxShadow: active ? `0 0 0 3px ${c.bg}` : 'none',
                      }}
                    >
                      {active && <Check size={16} strokeWidth={2.5} color={c.text} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Место</label>
              <input
                className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                placeholder="Адрес или название места"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Описание</label>
              <textarea
                className="w-full bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 py-3 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary resize-none"
                placeholder="Доп. информация о задаче"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex gap-2.5 mt-2">
              <button
                onClick={() => onDelete(task.id)}
                className="flex-1 h-[48px] bg-gradient-to-r from-danger/20 to-danger/10 text-danger rounded-[12px] font-semibold text-[15px] active:opacity-85 transition-opacity border border-danger/30 hover:from-danger/30 hover:to-danger/20"
              >
                Удалить
              </button>
              <button
                onClick={handleUpdate}
                className="flex-[2] h-[48px] bg-accent text-white rounded-[12px] font-bold text-[15px] active:opacity-85 transition-opacity"
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
