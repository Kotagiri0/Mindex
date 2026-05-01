import React, { useState, useMemo } from 'react';
import { ChevronLeft, Plus, Settings, Menu } from 'lucide-react';
import { CalendarDays, ChevronLeft, Plus, Settings, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';

interface DashboardProps {
  tasks: Task[];
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onLogout: () => void;
}

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const F = "'Random Grotesque', sans-serif";

export default function Dashboard({ tasks, setTasks, onNavigate, onOpenThread, onLogout }: DashboardProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const weekDays = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dow + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter(t => (t.date || today) === selectedDate)
      .sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });
  }, [tasks, selectedDate, today]);

  const toggleTask = async (id: string) => {
    const updated = tasks.map(t => {
      if (t.id === id) {
        const newTask = { ...t, done: !t.done };
        db.saveTask(newTask);
        return newTask;
      }
      return t;
    });
    setTasks(updated);
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    const updated = tasks.map(t => {
      if (t.id === taskId && t.subtasks) {
        const newSubtasks = t.subtasks.map(st =>
          st.id === subtaskId ? { ...st, done: !st.done } : st
        );
        const newTask = { ...t, subtasks: newSubtasks };
        db.saveTask(newTask);
        return newTask;
      }
      return t;
    });
    setTasks(updated);
  };

  const addTask = async (name: string, time: string, date: string) => {
    const newTask: Task = { id: uuid(), name, time, date, done: false };
    setTasks(prev => (Array.isArray(prev) ? [...prev, newTask] : [newTask]));
    await db.saveTask(newTask);
    setIsAddModalOpen(false);
  };

  const updateTask = async (id: string, name: string, time: string, date: string) => {
    const updated = tasks.map(t => {
      if (t.id === id) {
        const newTask = { ...t, name, time, date };
        db.saveTask(newTask);
        return newTask;
      }
      return t;
    });
    setTasks(updated);
    setEditingTask(null);
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    await db.deleteTask(id);
    setEditingTask(null);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#f0f0f0' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => setWeekOffset(v => v - 1)}
          className="w-11 h-11 flex items-center justify-center"
        >
          <ChevronLeft size={24} strokeWidth={1.75} color="#222224" />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => { setSelectedDate(today); setWeekOffset(0); }}
          className="flex flex-col items-center"
        >
          <span style={{ fontFamily: F, fontSize: '11px', color: 'rgba(34,34,36,0.4)', letterSpacing: '0.06em' }}>
            {weekDays[3].getFullYear()}
          </span>
          <span style={{ fontFamily: F, fontSize: '22px', color: '#222224', lineHeight: 1.1 }}>
            {MONTHS[weekDays[3].getMonth()]}
          </span>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          className="w-11 h-11 flex items-center justify-center"
        >
          <Settings size={22} strokeWidth={1.75} color="rgba(34,34,36,0.6)" />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('cal')}
          className="w-11 h-11 flex items-center justify-center"
          aria-label="Open calendar"
        >
          <CalendarDays size={22} strokeWidth={1.75} color="rgba(34,34,36,0.6)" />
        </motion.button>
      </div>

      <div className="grid grid-cols-7 px-4 pb-3 pt-1">
        {weekDays.map((d, i) => {
          const ds = d.toISOString().split('T')[0];
          const isSelected = ds === selectedDate;
          const isToday = ds === today;

          return (
            <motion.button
              key={ds}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSelectedDate(ds)}
              className="flex flex-col items-center gap-1 py-1"
            >
              <span style={{ fontSize: '11px', color: 'rgba(34,34,36,0.4)', fontFamily: F, letterSpacing: '0.04em' }}>
                {DAYS[i]}
              </span>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
                style={{ background: isSelected ? '#222224' : 'transparent' }}
              >
                <span style={{
                  fontSize: '18px',
                  fontFamily: F,
                  color: isSelected ? '#ffffff' : '#222224',
                  fontWeight: isToday && !isSelected ? 700 : 400,
                }}>
                  {d.getDate()}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: '#ffffff', borderRadius: '24px 24px 0 0' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => alert('Сортировка и фильтры будут в ближайших обновлениях')}
            className="w-10 h-10 flex items-center justify-center"
          >
            <Menu size={20} strokeWidth={1.75} color="rgba(34,34,36,0.45)" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => setIsAddModalOpen(true)}
            className="w-10 h-10 flex items-center justify-center"
          >
            <Plus size={22} strokeWidth={1.75} color="#222224" />
          </motion.button>
        </div>

        <div style={{ height: '1px', background: 'rgba(34,34,36,0.08)', margin: '0 20px' }} />

        <div className="flex-1 overflow-y-auto px-5 pb-20">
          {filteredTasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
              style={{ color: 'rgba(34,34,36,0.3)', fontFamily: F, fontSize: '15px' }}
            >
              Нет задач на этот день
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {filteredTasks.map((t, idx) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <TaskItem
                    task={t}
                    onToggle={() => toggleTask(t.id)}
                    onToggleSubtask={toggleSubtask}
                    onClick={() => setEditingTask(t)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      <AddTaskModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={addTask}
        initialDate={selectedDate}
      />

      <EditTaskModal
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onUpdate={updateTask}
        onDelete={deleteTask}
        onOpenThread={onOpenThread}
      />
    </div>
  );
}
