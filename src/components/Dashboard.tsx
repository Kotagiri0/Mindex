import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';

interface DashboardProps {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onLogout: () => void;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

export default function Dashboard({ tasks, setTasks, onNavigate, onNewThread, onOpenThread, onLogout }: DashboardProps) {
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
    const newTask: Task = {
      id: uuid(),
      name,
      time,
      date,
      done: false
    };
    setTasks([...tasks, newTask]);
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

  const sectionTitle = useMemo(() => {
    if (selectedDate === today) return 'Задачи на сегодня';
    const d = new Date(selectedDate);
    return `Задачи на ${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  }, [selectedDate, today]);

  return (
    <div className="flex flex-col h-full bg-bg transition-theme">
      <div className="safe-top flex-shrink-0" />
      
      <div className="px-4 pt-2 flex-shrink-0">
        <div className="flex items-center justify-end mb-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onLogout}
            className="h-9 px-3 rounded-full bg-surface text-text-primary text-[12px] font-semibold flex items-center gap-2 border border-border active:opacity-70 transition-opacity"
          >
            <LogOut size={14} />
            Выйти
          </motion.button>
        </div>

        <div className="flex items-center gap-1 mb-2">
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setWeekOffset(v => v - 1)} 
            className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-text-secondary hover:bg-surface transition-colors"
          >
            <ChevronLeft size={18} />
          </motion.button>
          <div className="flex-1 text-center text-[13px] font-bold text-text-secondary uppercase tracking-wider">
            {MONTHS[weekDays[3].getMonth()]} {weekDays[3].getFullYear()}
          </div>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setWeekOffset(v => v + 1)} 
            className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-text-secondary hover:bg-surface transition-colors"
          >
            <ChevronRight size={18} />
          </motion.button>
        </div>

        <div className="grid grid-cols-7 gap-[6px] mb-1">
          {weekDays.map((d, i) => {
            const ds = d.toISOString().split('T')[0];
            const isSelected = ds === selectedDate;
            
            return (
              <motion.button
                key={ds}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedDate(ds)}
                className={`h-[72px] rounded-[14px] flex flex-col items-center justify-center gap-1.5 transition-colors ${
                  isSelected ? 'bg-accent text-white' : 'bg-surface text-text-primary'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="day-indicator"
                    className="absolute inset-0 bg-gradient-to-br from-accent/50 to-transparent rounded-[14px] -z-10"
                    transition={{ type: 'spring', bounce: 0.2 }}
                  />
                )}
                <span className={`text-[11px] font-bold ${isSelected ? 'text-white/90' : 'text-text-tertiary'}`}>
                  {DAYS[i]}
                </span>
                <span className={`text-[18px] font-bold`}>
                  {d.getDate()}
                </span>
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {selectedDate !== today && (
            <motion.button
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onClick={() => { setSelectedDate(today); setWeekOffset(0); }}
              className="w-full text-center text-[12px] font-semibold text-accent h-[16px] mb-1"
            >
              ← Вернуться на сегодня
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 bg-surface rounded-t-[32px] shadow-lg flex flex-col min-h-0 transition-colors">
        <div className="flex justify-end items-center px-6 pt-6 pb-2">
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsAddModalOpen(true)} 
            className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-accent active:opacity-70 transition-opacity"
          >
            <Plus size={24} strokeWidth={2.5} />
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-32 scrollbar-hide">
          {filteredTasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-text-tertiary py-12 px-4 text-[15px]"
            >
              Нет задач на этот день
            </motion.div>
          ) : (
            <div className="flex flex-col gap-1">
              <AnimatePresence mode="popLayout">
                {filteredTasks.map((t, idx) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.05 }}
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
            </div>
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
