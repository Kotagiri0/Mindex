import React, { useState, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Screen } from '../types';
import TaskItem from './TaskItem';
import EditTaskModal, { TaskEditPatch } from './EditTaskModal';
import DayTimeline from './DayTimeline';
import TimelineCreatePopover from './TimelineCreatePopover';
import { CalendarGridIcon, TodoIcon, SettingsIcon } from './icons';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';

// Вид панели задач: список (как было) или таймлайн (календарь дня). Запоминается навсегда.
type DashView = 'list' | 'timeline';
const VIEW_KEY = 'mx_dash_view';
const readView = (): DashView => (localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'list');

interface DashboardProps {
  tasks: Task[];
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onLogout: () => void;
}

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";
const RS = "'Russisch Sans', sans-serif";
const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

function dateToStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() { return dateToStr(new Date()); }

function getWeekDays(weekOffset: number) {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7) + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ─── Mini calendar popup ────────────────────────────────────────────────────

function MiniCalendar({ selected, onSelect, onClose }: {
  selected: string;
  onSelect: (ds: string) => void;
  onClose: () => void;
}) {
  const today = todayStr();
  const selDate = new Date(selected + 'T00:00:00');
  const [year, setYear] = useState(selDate.getFullYear());
  const [month, setMonth] = useState(selDate.getMonth());

  const firstDay = new Date(year, month, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // monday=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', background: '#fff', borderRadius: '24px 24px 0 0', padding: '20px 20px 36px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8 }}>
            <ChevronLeft size={20} strokeWidth={1.75} color="#222224" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(34,34,36,0.4)', letterSpacing: '0.06em' }}>{year}</div>
            <div style={{ fontFamily: F, fontSize: 20, color: '#222224' }}>{MONTHS[month]}</div>
          </div>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8 }}>
            <ChevronRight size={20} strokeWidth={1.75} color="#222224" />
          </button>
        </div>

        {/* Day names */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontFamily: F, fontSize: 11, color: 'rgba(34,34,36,0.4)', letterSpacing: '0.04em', padding: '4px 0' }}>{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isSel = ds === selected;
            const isToday = ds === today;
            const isWeekend = idx % 7 >= 5;
            return (
              <div key={ds} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <button
                  onClick={() => { onSelect(ds); onClose(); }}
                  style={{
                    width: 36, height: 36, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: 'pointer', borderRadius: '50%',
                    background: isSel ? '#0B0D10' : isToday ? 'rgba(11,13,16,0.14)' : 'transparent',
                  }}
                >
                  <span style={{
                    fontFamily: isSel || isToday ? "'Helvetica Neue', Helvetica, sans-serif" : M,
                    fontSize: 15,
                    fontWeight: isSel || isToday ? 700 : 400,
                    color: isSel ? '#fff' : isToday ? '#fff' : isWeekend ? 'rgba(34,34,36,0.3)' : '#999B9E',
                  }}>
                    {day}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard({ tasks, setTasks, onNavigate, onOpenThread }: DashboardProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [weekDir, setWeekDir] = useState(0);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartX = useRef(0);
  const suppressClickRef = useRef(false);
  const [miniCalOpen, setMiniCalOpen] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [view, setView] = useState<DashView>(readView);
  // Время, по которому тапнули на таймлайне для создания задачи (null — попровер закрыт).
  const [createAt, setCreateAt] = useState<string | null>(null);
  const today = todayStr();

  const toggleView = () => {
    setView(prev => {
      const next = prev === 'list' ? 'timeline' : 'list';
      localStorage.setItem(VIEW_KEY, next);
      return next;
    });
  };

  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const filteredTasks = useMemo(() =>
    tasks
      .filter(t => (t.date || today) === selectedDate)
      .sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      }),
    [tasks, selectedDate, today]
  );

  const goWeek = (dir: number) => {
    setWeekDir(dir);
    setWeekOffset(v => v + dir);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50) goWeek(delta > 0 ? -1 : 1);
  };

  const handleSelectDate = (ds: string) => {
    setSelectedDate(ds);
    // sync week offset if needed
    const d = new Date(ds + 'T00:00:00');
    const now = new Date();
    const todayMonday = new Date(now);
    const dow = now.getDay();
    todayMonday.setDate(now.getDate() - ((dow + 6) % 7));
    const targetMonday = new Date(d);
    const tdow = d.getDay();
    targetMonday.setDate(d.getDate() - ((tdow + 6) % 7));
    const diff = Math.round((targetMonday.getTime() - todayMonday.getTime()) / (7 * 86400000));
    setWeekOffset(diff);
  };

  const addTask = async () => {
    const name = addInput.trim();
    if (!name) return;
    const newTask: Task = { id: uuid(), name, time: '', date: selectedDate, done: false, category: 'none' };
    setTasks(prev => (Array.isArray(prev) ? [...prev, newTask] : [newTask]));
    await db.saveTask(newTask);
    setAddInput('');
  };

  // Перетаскивание блока по таймлайну: человек явно переместил → timeSource: 'user'.
  const moveTask = (taskId: string, time: string, endTime: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const u: Task = { ...t, time, endTime, timeSource: 'user' };
      db.saveTask(u);
      return u;
    }));
  };

  // Создание задачи тапом по таймлайну: человек явно указал время → timeSource: 'user'.
  const createTimedTask = async (name: string, time: string, endTime: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newTask: Task = {
      id: uuid(), name: trimmed, time, endTime, date: selectedDate,
      done: false, category: 'none', timeSource: 'user',
    };
    setTasks(prev => (Array.isArray(prev) ? [...prev, newTask] : [newTask]));
    await db.saveTask(newTask);
    setCreateAt(null);
  };

  const toggleTask = async (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId && t.subtasks) {
        const u = { ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, done: !st.done } : st) };
        db.saveTask(u);
        return u;
      }
      return t;
    }));
  };

  const updateTask = async (id: string, patch: TaskEditPatch) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const u: Task = {
        ...t,
        name: patch.name,
        time: patch.time,
        endTime: patch.endTime || undefined,
        date: patch.date,
        description: patch.description,
        location: patch.location,
        category: patch.category,
        // Если время правил человек руками — фиксируем источник как 'user'.
        timeSource: patch.timeChangedByUser ? 'user' : t.timeSource,
        // Появилось реальное время — предложение агента больше не нужно.
        suggestedTime: patch.time ? undefined : t.suggestedTime,
        suggestedEndTime: patch.time ? undefined : t.suggestedEndTime,
      };
      db.saveTask(u);
      return u;
    }));
    setEditingTask(null);
  };

  const deleteTask = async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    await db.deleteTask(id);
    setEditingTask(null);
  };

  const handleWeekSwipeStart = (x: number, y: number) => {
    swipeStartRef.current = { x, y };
  };

  const handleWeekSwipeEnd = (x: number, y: number) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const deltaX = x - start.x;
    const deltaY = y - start.y;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) return;

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    if (deltaX < 0) {
      setWeekDir(1);
      setWeekOffset((value) => value + 1);
      const next = new Date(weekDays[0]);
      next.setDate(next.getDate() + 7);
      setSelectedDate(next.toISOString().split('T')[0]);
    } else {
      setWeekDir(-1);
      setWeekOffset((value) => value - 1);
      const prev = new Date(weekDays[0]);
      prev.setDate(prev.getDate() - 7);
      setSelectedDate(prev.toISOString().split('T')[0]);
    }
  };

  const handleDaySwipeEnd = (x: number, y: number) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const deltaX = x - start.x;
    const deltaY = y - start.y;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) return;

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const direction = deltaX < 0 ? 1 : -1;
    const currentIndex = weekDays.findIndex(
      (day) => day.toISOString().split('T')[0] === selectedDate,
    );

    if (direction === 1) {
      if (currentIndex < 6) {
        setSelectedDate(weekDays[currentIndex + 1].toISOString().split('T')[0]);
      } else {
        setWeekOffset((value) => value + 1);
        const next = new Date(weekDays[0]);
        next.setDate(next.getDate() + 7);
        setSelectedDate(next.toISOString().split('T')[0]);
      }
    } else {
      if (currentIndex > 0) {
        setSelectedDate(weekDays[currentIndex - 1].toISOString().split('T')[0]);
      } else {
        setWeekOffset((value) => value - 1);
        const prev = new Date(weekDays[0]);
        prev.setDate(prev.getDate() - 1);
        setSelectedDate(prev.toISOString().split('T')[0]);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 8px' }}>
        {/* Левая иконка — переключатель список ⇄ таймлайн.
            Открыт список → иконка календаря (перейти в таймлайн).
            Открыт таймлайн → иконка to-do (вернуть список). */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={toggleView}
          aria-label={view === 'list' ? 'Календарь' : 'Список'}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {view === 'list'
            ? <CalendarGridIcon size={22} color="rgba(34,34,36,0.6)" />
            : <TodoIcon size={22} color="rgba(34,34,36,0.6)" />}
        </motion.button>

        {/* Заголовок месяца — тап открывает мини-календарь для прыжка по датам */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setMiniCalOpen(true)}
          style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {weekDays[3].getFullYear() !== new Date().getFullYear() && (
            <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(34,34,36,0.4)', letterSpacing: '0.06em' }}>
              {weekDays[3].getFullYear()}
            </div>
          )}
          <div style={{ fontFamily: F, fontSize: 22, color: '#222224', lineHeight: 1.1, opacity: 0.7 }}>
            {MONTHS[weekDays[3].getMonth()]}
          </div>
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <SettingsIcon size={26} color="rgba(34,34,36,0.6)" />
        </motion.button>

      </div>

      {/* Week strip — swipeable */}
      <div
        style={{ overflow: 'hidden', touchAction: 'none' }}
        onTouchStart={(e) => handleWeekSwipeStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={(e) => handleWeekSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
        onTouchCancel={() => { swipeStartRef.current = null; }}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={weekDir}>
        <motion.div
          key={weekOffset}
          custom={weekDir}
          initial={{ x: weekDir * 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: weekDir * -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 38 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '20px 20px 8px' }}
        >
        {weekDays.map((d, i) => {
          const ds = dateToStr(d);
          const isSel = ds === selectedDate;
          const isToday = ds === today;
          const isWeekend = i >= 5;
          return (
            <motion.button
              key={ds}
              whileTap={{ scale: 0.9 }}
              onClick={() => { if (!suppressClickRef.current) setSelectedDate(ds); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{
                fontSize: 11, fontFamily: RS, fontWeight: 600, letterSpacing: '0.04em',
                color: isWeekend ? 'rgba(34,34,36,0.22)' : 'rgba(34,34,36,0.4)',
              }}>
                {DAYS[i]}
              </span>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isSel ? '#0B0D10' : isToday ? 'rgba(11,13,16,0.18)' : 'transparent',
              }}>
                <span style={{
                  fontFamily: "'Helvetica Neue', Helvetica, sans-serif",
                  fontSize: 16,
                  fontWeight: isSel ? 700 : 400,
                  color: isSel ? '#fff' : isToday ? '#0B0D10' : isWeekend ? 'rgba(34,34,36,0.28)' : '#999B9E',
                }}>
                  {d.getDate()}
                </span>
              </div>
            </motion.button>
          );
        })}
        </motion.div>
        </AnimatePresence>
      </div>

      {/* Tasks panel */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#ffffff', borderRadius: '36px 36px 0 0', overflow: 'hidden', touchAction: 'none' }}
        onTouchStart={(e) => handleWeekSwipeStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={(e) => handleDaySwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
        onTouchCancel={() => { swipeStartRef.current = null; }}
      >
        {view === 'list' ? (
          <>
            {/* Inline add-task input */}
            <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f5f5f5', borderRadius: 40, padding: '10px 16px' }}>
                <Plus size={18} strokeWidth={1.75} color="rgba(34,34,36,0.3)" style={{ flexShrink: 0 }} />
                <input
                  value={addInput}
                  onChange={e => setAddInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Добавить задачу"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 15, color: '#222224' }}
                />
                <AnimatePresence>
                  {addInput.trim() && (
                    <motion.button
                      key="add-btn"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={addTask}
                      style={{ width: 32, height: 32, borderRadius: '50%', background: '#0B0D10', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                      <ArrowUp size={16} color="#fff" strokeWidth={2} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div style={{ height: 1, background: 'rgba(34,34,36,0.07)', margin: '12px 20px 0' }} />

            {/* Task list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 120px', touchAction: 'pan-y' }}>
              {filteredTasks.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ textAlign: 'center', marginTop: 40, color: '#bbb', fontFamily: M, fontSize: 15 }}
                >
                  Нет задач на этот день
                </motion.div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {filteredTasks.map((t, idx) => (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
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
          </>
        ) : (
          <div style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>
            <DayTimeline
              date={selectedDate}
              tasks={filteredTasks}
              onTaskClick={(t) => setEditingTask(t)}
              onUntimedClick={(t) => setEditingTask(t)}
              onCreateAt={(time) => setCreateAt(time)}
              onTaskMove={moveTask}
            />
          </div>
        )}
      </div>

      {/* "Сегодня" button — появляется когда не на текущей неделе */}
      <AnimatePresence>
        {(weekOffset !== 0 || selectedDate !== todayStr()) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              bottom: 'max(110px, calc(env(safe-area-inset-bottom, 0px) + 110px))',
              left: 0, right: 0,
              display: 'flex', justifyContent: 'center',
              zIndex: 101,
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'auto' }}>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => {
                setWeekOffset(0);
                setSelectedDate(todayStr());
              }}
              style={{
                background: 'rgba(34,34,36,0.1)',
                color: '#222224',
                border: 'none',
                borderRadius: 999,
                padding: '9px 20px',
                fontFamily: M,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                whiteSpace: 'nowrap',
              }}
            >
              Сегодня
            </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <EditTaskModal
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onUpdate={updateTask}
        onDelete={deleteTask}
        onOpenThread={onOpenThread}
      />

      {/* Создание задачи тапом по таймлайну */}
      <AnimatePresence>
        {createAt && (
          <TimelineCreatePopover
            startTime={createAt}
            onCancel={() => setCreateAt(null)}
            onCreate={createTimedTask}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {miniCalOpen && (
          <MiniCalendar
            selected={selectedDate}
            onSelect={handleSelectDate}
            onClose={() => setMiniCalOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
