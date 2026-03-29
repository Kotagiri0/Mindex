import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import { db } from '../lib/db';

interface DashboardProps {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

export default function Dashboard({ tasks, setTasks, onNavigate, onNewThread, onOpenThread }: DashboardProps) {
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
      id: crypto.randomUUID(),
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
    <div className="flex flex-col h-full bg-[#F2F2F7]">
      <div className="safe-top flex-shrink-0" />
      
      <div className="px-4 pt-2 flex-shrink-0">
        <div className="flex items-center gap-1 mb-2">
          <button onClick={() => setWeekOffset(v => v - 1)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[#3C3C43]/60 hover:bg-black/5 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 text-center text-[13px] font-bold text-[#3C3C43]/60 uppercase tracking-wider">
            {MONTHS[weekDays[3].getMonth()]} {weekDays[3].getFullYear()}
          </div>
          <button onClick={() => setWeekOffset(v => v + 1)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[#3C3C43]/60 hover:bg-black/5 transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-[6px] mb-1">
          {weekDays.map((d, i) => {
            const ds = d.toISOString().split('T')[0];
            const isSelected = ds === selectedDate;
            
            return (
              <button
                key={ds}
                onClick={() => setSelectedDate(ds)}
                className={`h-[72px] rounded-[14px] flex flex-col items-center justify-center gap-1.5 transition-all ${
                  isSelected ? 'bg-[#749BFF] text-white shadow-[0_4px_12px_rgba(116,155,255,0.3)]' : 'bg-transparent'
                }`}
              >
                <span className={`text-[11px] font-bold ${isSelected ? 'text-white/80' : 'text-[#8E8E93]'}`}>
                  {DAYS[i]}
                </span>
                <span className={`text-[18px] font-bold ${isSelected ? 'text-white' : 'text-[#1C1C1E]'}`}>
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => { setSelectedDate(today); setWeekOffset(0); }}
          className={`w-full text-center text-[12px] font-semibold text-[#4880FF] h-[16px] mb-1 transition-opacity duration-200 ${
            selectedDate !== today ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          ← Вернуться к сегодня
        </button>
      </div>

      <div className="flex-1 bg-white rounded-t-[32px] shadow-[0_-8px_24px_rgba(0,0,0,0.03)] flex flex-col min-h-0">
        <div className="flex justify-end items-center px-6 pt-6 pb-2">
          <button 
            onClick={() => setIsAddModalOpen(true)} 
            className="w-10 h-10 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#4880FF] active:scale-90 transition-transform"
          >
            <Plus size={24} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-32 scrollbar-hide">
          {filteredTasks.length === 0 ? (
            <div className="text-center text-[#8E8E93] py-12 px-4 text-[15px]">
              Нет задач на этот день
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredTasks.map(t => (
                <TaskItem 
                  key={t.id} 
                  task={t} 
                  onToggle={() => toggleTask(t.id)} 
                  onToggleSubtask={toggleSubtask}
                  onClick={() => setEditingTask(t)} 
                />
              ))}
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
