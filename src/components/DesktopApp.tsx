import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  CalendarDays, MessageCircle, Settings, Plus, LogOut, ChevronLeft,
  ChevronRight, PenLine, Search, ArrowUp, StickyNote, Check,
  ChevronDown as ChevronDownIcon, Mic, Loader
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, Thread, Settings as SettingsType, Screen } from '../types';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import SettingsScreen from './Settings';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { useVoiceInput } from '../lib/useVoiceInput';

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

const F = "'Random Grotesque', sans-serif";
const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

function LogoIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="130 4 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="131.436" y="5.883" width="156.324" height="156.324" rx="78.162" stroke="#222224" strokeWidth="11.766"/>
      <path d="M260.026 84.047H159.172" stroke="#222224" strokeWidth="11.766"/>
      <path d="M233.37 60.273L185.827 107.816" stroke="#222224" strokeWidth="11.766"/>
      <path d="M233.371 107.816L185.828 60.273" stroke="#222224" strokeWidth="11.766"/>
      <path d="M209.599 134.473L209.599 33.619" stroke="#222224" strokeWidth="11.766"/>
    </svg>
  );
}

interface DesktopAppProps {
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  settings: SettingsType;
  setSettings: (s: SettingsType) => void;
  screen: Screen;
  setScreen: (s: Screen) => void;
  curTh: string | null;
  setCurTh: (id: string | null) => void;
  startNewThread: () => void;
  handleLogout: () => void;
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-11 h-11 rounded-[12px] flex items-center justify-center transition-colors"
      style={{ background: active ? '#222224' : 'transparent' }}
    >
      <span style={{ color: active ? '#ffffff' : 'rgba(34,34,36,0.4)', display: 'flex' }}>
        {icon}
      </span>
    </button>
  );
}

function DesktopTaskItem({ task, onToggle, onToggleSubtask, onClick }: {
  task: Task; onToggle: () => void; onClick: () => void;
  onToggleSubtask?: (taskId: string, subtaskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSub = task.subtasks && task.subtasks.length > 0;

  return (
    <div style={{ borderBottom: '1px solid rgba(34,34,36,0.07)' }}>
      <div className="flex items-center gap-4 py-3.5 cursor-pointer group" onClick={onClick}>
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className="flex-shrink-0 flex items-center justify-center transition-all"
          style={{
            width: '26px', height: '26px', borderRadius: '50%',
            border: `1.75px solid ${task.done ? '#222224' : 'rgba(34,34,36,0.25)'}`,
            background: task.done ? '#222224' : 'transparent',
          }}
        >
          {task.done && <Check size={12} color="#ffffff" strokeWidth={2.5} />}
        </button>
        <span className="flex-1 truncate" style={{
          fontFamily: M, fontSize: '15px',
          color: task.done ? 'rgba(34,34,36,0.3)' : '#222224',
          textDecoration: task.done ? 'line-through' : 'none',
        }}>
          {task.name}
        </span>
        {task.time && (
          <span style={{ fontFamily: M, fontSize: '13px', color: 'rgba(34,34,36,0.38)', flexShrink: 0 }}>
            {task.time}
          </span>
        )}
        {hasSub && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            style={{ transform: `rotate(${expanded ? 180 : 0}deg)`, transition: 'transform 0.2s', flexShrink: 0 }}
          >
            <ChevronDownIcon size={16} color="rgba(34,34,36,0.35)" />
          </button>
        )}
      </div>
      {expanded && hasSub && (
        <div className="pl-12 pb-2 flex flex-col gap-1.5">
          {task.subtasks?.map(st => (
            <div key={st.id} onClick={() => onToggleSubtask?.(task.id, st.id)} className="flex items-center gap-3 py-1 cursor-pointer">
              <div style={{
                width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                border: `1.5px solid ${st.done ? '#222224' : 'rgba(34,34,36,0.22)'}`,
                background: st.done ? '#222224' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {st.done && <Check size={10} color="#ffffff" strokeWidth={2.5} />}
              </div>
              <span style={{
                fontFamily: M, fontSize: '13px',
                color: st.done ? 'rgba(34,34,36,0.3)' : '#222224',
                textDecoration: st.done ? 'line-through' : 'none',
              }}>{st.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardPanel({
  weekDays, weekOffset, setWeekOffset, selectedDate, setSelectedDate,
  today, filteredTasks, toggleTask, toggleSubtask, onAddTask, onEditTask,
  onQuickAddTask, onQuickChat,
}: {
  weekDays: Date[]; weekOffset: number; setWeekOffset: (fn: (v: number) => number) => void;
  selectedDate: string; setSelectedDate: (d: string) => void; today: string;
  filteredTasks: Task[]; toggleTask: (id: string) => void;
  toggleSubtask: (tId: string, sId: string) => void;
  onAddTask: () => void; onEditTask: (t: Task) => void;
  onQuickAddTask: (name: string) => void;
  onQuickChat: (msg: string) => void;
}) {
  const [quickTask, setQuickTask] = useState('');
  const [quickChat, setQuickChat] = useState('');

  const month = MONTHS[weekDays[3].getMonth()];
  const year = weekDays[3].getFullYear();
  const selDay = new Date(selectedDate);
  const selLabel = selDay.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });

  const handleQuickTask = () => {
    if (!quickTask.trim()) return;
    onQuickAddTask(quickTask.trim());
    setQuickTask('');
  };

  const handleQuickChat = () => {
    if (!quickChat.trim()) return;
    onQuickChat(quickChat.trim());
    setQuickChat('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekOffset(v => v - 1)} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(34,34,36,0.06)]">
            <ChevronLeft size={17} strokeWidth={1.75} color="#222224" />
          </button>
          <button onClick={() => setWeekOffset(v => v + 1)} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(34,34,36,0.06)]">
            <ChevronRight size={17} strokeWidth={1.75} color="#222224" />
          </button>
          <div>
            <span style={{ fontFamily: M, fontSize: '11px', color: 'rgba(34,34,36,0.38)', letterSpacing: '0.06em', display: 'block' }}>{year}</span>
            <span style={{ fontFamily: M, fontSize: '20px', color: '#222224', lineHeight: 1 }}>{month}</span>
          </div>
        </div>
        <button onClick={onAddTask} className="h-9 px-4 rounded-full flex items-center gap-2 transition-opacity hover:opacity-80" style={{ background: '#222224' }}>
          <Plus size={15} strokeWidth={2} color="#ffffff" />
          <span style={{ fontFamily: M, fontSize: '13px', color: '#ffffff' }}>Добавить задачу</span>
        </button>
      </div>

      <div style={{ height: '1px', background: 'rgba(34,34,36,0.08)', margin: '0 32px' }} />

      <div className="grid grid-cols-7 px-8 py-3 flex-shrink-0">
        {weekDays.map((d, i) => {
          const ds = d.toISOString().split('T')[0];
          const isSelected = ds === selectedDate;
          const isToday = ds === today;
          return (
            <button key={ds} onClick={() => setSelectedDate(ds)} className="flex flex-row items-center justify-center gap-2 py-2 rounded-[10px] transition-colors hover:bg-[rgba(34,34,36,0.04)]">
              <span style={{ fontSize: '12px', color: 'rgba(34,34,36,0.38)', fontFamily: M }}>{DAYS[i]}</span>
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: isSelected ? '#222224' : 'transparent' }}>
                <span style={{ fontSize: '17px', fontFamily: M, color: isSelected ? '#ffffff' : isToday ? '#222224' : 'rgba(34,34,36,0.65)', fontWeight: isToday && !isSelected ? 700 : 400 }}>
                  {d.getDate()}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ height: '1px', background: 'rgba(34,34,36,0.08)', margin: '0 32px' }} />

      <div className="px-8 pt-4 pb-2 flex-shrink-0">
        <span style={{ fontFamily: M, fontSize: '13px', color: 'rgba(34,34,36,0.38)', textTransform: 'capitalize' }}>{selLabel}</span>
      </div>

      <div className="px-8 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 h-9 px-3 rounded-[10px]" style={{ background: '#ffffff', border: '1px solid rgba(34,34,36,0.09)' }}>
          <Plus size={14} strokeWidth={1.75} color="rgba(34,34,36,0.3)" />
          <input
            className="flex-1 bg-transparent outline-none"
            style={{ fontFamily: M, fontSize: '14px', color: '#222224' }}
            placeholder="Добавить задачу..."
            value={quickTask}
            onChange={e => setQuickTask(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleQuickTask()}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-4 min-h-0">
        {filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <span style={{ fontFamily: M, fontSize: '14px', color: 'rgba(34,34,36,0.25)' }}>Нет задач на этот день</span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredTasks.map((t, idx) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.03 }}>
                <DesktopTaskItem task={t} onToggle={() => toggleTask(t.id)} onToggleSubtask={toggleSubtask} onClick={() => onEditTask(t)} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="px-8 pb-6 flex-shrink-0">
        <div className="flex items-center gap-3 px-4 rounded-2xl" style={{ background: '#ffffff', border: '1px solid rgba(34,34,36,0.09)', height: '52px' }}>
          <input
            className="flex-1 bg-transparent outline-none"
            style={{ fontFamily: M, fontSize: '15px', color: '#222224' }}
            placeholder="Написать Мысли..."
            value={quickChat}
            onChange={e => setQuickChat(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleQuickChat()}
          />
          <button onClick={handleQuickChat} disabled={!quickChat.trim()} className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors" style={{ background: quickChat.trim() ? '#222224' : 'rgba(34,34,36,0.1)' }}>
            <ArrowUp size={16} strokeWidth={2} color="#ffffff" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

function DesktopChat({
  threadId, threads, setThreads, tasks, setTasks, onClose, initialMessage, onInitialConsumed,
}: {
  key?: React.Key;
  threadId: string;
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  onClose: () => void;
  initialMessage?: string | null;
  onInitialConsumed?: () => void;
}) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const didAutoSend = useRef(false);

  const { state: voiceState, error: voiceError, startRecording, stopRecording } = useVoiceInput(
    (text) => {
      setInput(prev => prev + (prev ? ' ' : '') + text);
    }
  );

  const thread = threads.find(t => t.id === threadId);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread?.messages, isTyping]);

  useEffect(() => {
    if (initialMessage && !didAutoSend.current) {
      didAutoSend.current = true;
      onInitialConsumed?.();
      sendMessage(initialMessage);
    }
  }, []);

  if (!thread) return null;

  const ft = () => {
    const n = new Date();
    return n.getHours().toString().padStart(2, '0') + ':' + n.getMinutes().toString().padStart(2, '0');
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: text, time: ft() };
    let updatedThread: Thread | undefined;

    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === threadId) {
        updatedThread = { ...t, messages: [...t.messages, userMsg], preview: text.slice(0, 60) };
        return updatedThread;
      }
      return t;
    }));
    if (updatedThread) db.saveThread(updatedThread);

    setIsTyping(true);
    try {
      const current = threads.find(t => t.id === threadId);
      if (!current) return;

      let history: Message[] = [...current.messages, userMsg];
      const turnMsgs: Message[] = [];
      let response = await generateResponse(history);

      while (response.tool_calls) {
        const toolResults: Message[] = [];
        const assistantMsg: Message = { role: 'assistant', content: response.content || '', tool_calls: response.tool_calls, time: ft() };
        turnMsgs.push(assistantMsg);

        for (const call of response.tool_calls) {
          const { name } = call.function;
          const args = JSON.parse(call.function.arguments);
          let result: any;

          if (name === 'get_tasks') {
            const filtered = args.date ? tasks.filter(t => t.date === args.date) : tasks;
            result = filtered.length > 0 ? filtered : 'Задач не найдено.';
          } else if (name === 'add_task') {
            const newTask: Task = { id: uuid(), name: args.name, time: args.time || '', date: args.date || new Date().toISOString().split('T')[0], done: false, threadId };
            setTasks(prev => [...(Array.isArray(prev) ? prev : []), newTask]);
            db.saveTask(newTask);
            result = { status: 'success', task: newTask };
          } else if (name === 'update_task') {
            setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
              if (t.id === args.id) { const u = { ...t, done: args.done ?? t.done, name: args.name || t.name, time: args.time ?? t.time, date: args.date ?? t.date }; db.saveTask(u); return u; }
              return t;
            }));
            result = { status: 'success' };
          } else if (name === 'delete_task') {
            setTasks(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== args.id));
            db.deleteTask(args.id);
            result = { status: 'success' };
          } else if (name === 'start_planning') {
            const { questions } = args;
            const planningMsg: Message = {
              role: 'assistant',
              content: 'Чтобы составить лучший план, мне нужно уточнить пару деталей:',
              time: ft(),
              planning_data: {
                questions,
                status: 'questionnaire'
              }
            };
            setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
              if (t.id === threadId) {
                const u = { ...t, messages: [...t.messages, planningMsg] };
                db.saveThread(u);
                return u;
              }
              return t;
            }));
            setIsTyping(false);
            return;
          }

          // СТАЛО
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? null), time: ft() });
        }

        turnMsgs.push(...toolResults);
        history = [...history, assistantMsg, ...toolResults];
        response = await generateResponse(history);
      }

      const finalMsg: Message = { role: 'assistant', content: response.content || 'Готово!', time: ft() };
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
        if (t.id === threadId) {
          const hasUser = t.messages.some(m => m.role === 'user' && m.content === userMsg.content && m.time === userMsg.time);
          const base = hasUser ? t.messages : [...t.messages, userMsg];
          const u = { ...t, messages: [...base, ...turnMsgs, finalMsg], preview: finalMsg.content.slice(0, 60) + '…' };
          db.saveThread(u);
          return u;
        }
        return t;
      }));
    } catch (err: any) {
      const errMsg: Message = { role: 'assistant', content: `Ошибка: ${err.message || 'Не удалось связаться с ИИ.'}`, time: ft() };
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
        if (t.id === threadId) { const u = { ...t, messages: [...t.messages, errMsg] }; db.saveThread(u); return u; }
        return t;
      }));
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = () => sendMessage(input);
  const visibleMessages = thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls);

  const handleDesktopAnswer = (msgIndex: number, questionId: string, answer: string) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== threadId) return t;
      const newMessages = [...t.messages];
      const targetIndex = t.messages.findIndex(m =>
        m.planning_data && m.planning_data.status === 'questionnaire'
      );
      if (targetIndex === -1) return t;
      const msg = { ...newMessages[targetIndex] };
      if (msg.planning_data) {
        msg.planning_data = {
          ...msg.planning_data,
          answers: { ...msg.planning_data.answers, [questionId]: answer }
        };

        const allAnswered = msg.planning_data.questions.every(q =>
          msg.planning_data?.answers?.[q.id]
        );

        if (allAnswered) {
          msg.planning_data.status = 'plan_generated';
          setTimeout(() => generatePlanFromAnswers(t, msg.planning_data!), 100);
        }
      }
      newMessages[targetIndex] = msg;
      const u = { ...t, messages: newMessages };
      db.saveThread(u);
      return u;
    }));
  };

  const generatePlanFromAnswers = async (t: Thread, planningData: any) => {
    setIsTyping(true);
    try {
      const answersText = Object.entries(planningData.answers)
        .map(([id, ans]) => {
          const q = planningData.questions.find((q: any) => q.id === id);
          return `Вопрос: ${q?.question}\nОтвет: ${ans}`;
        }).join('\n\n');

      const prompt = `Пользователь ответил на уточняющие вопросы:\n\n${answersText}\n\nНа основе этих ответов составь пошаговый план действий (to-do list).\nОтвечай СТРОГО в формате JSON:\n{\n  "title": "Название плана",\n  "steps": ["шаг 1", "шаг 2", ...]\n}`;

      const response = await generateResponse([
        ...t.messages,
        { role: 'user', content: prompt, time: ft() }
      ], { tool_choice: 'none' });

      if (!response || !response.content) {
        throw new Error('AI вернул пустой ответ при генерации плана.');
      }

      let jsonContent = response.content.trim();
      if (jsonContent.includes('```json')) {
        jsonContent = jsonContent.split('```json')[1].split('```')[0].trim();
      } else if (jsonContent.includes('```')) {
        jsonContent = jsonContent.split('```')[1].split('```')[0].trim();
      }

      const plan = JSON.parse(jsonContent);

      setThreads(prev => (Array.isArray(prev) ? prev : []).map(th => {
        if (th.id === threadId) {
          const newMessages = [...th.messages];
          const lastMsg = { ...newMessages[newMessages.length - 1] };
          if (lastMsg.planning_data) {
            lastMsg.planning_data = {
              ...lastMsg.planning_data,
              plan,
              status: 'plan_generated'
            };
          }
          newMessages[newMessages.length - 1] = lastMsg;
          const updated = { ...th, messages: newMessages };
          db.saveThread(updated);
          return updated;
        }
        return th;
      }));
    } catch (err) {
      console.error('Plan generation error:', err);
    } finally {
      setIsTyping(false);
    }
  };

  const updatePlanStep = (msgIndex: number, stepIndex: number, newName: string) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data?.plan) {
          const newSteps = [...m.planning_data.plan.steps];
          newSteps[stepIndex] = newName;
          m.planning_data.plan.steps = newSteps;
        }
        newMessages[msgIndex] = m;
        const updated = { ...t, messages: newMessages };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const handleAcceptPlan = async (msgIndex: number) => {
    if (!threadId || !thread) return;
    const msg = thread.messages[msgIndex];
    if (!msg.planning_data?.plan) return;

    const { title, steps } = msg.planning_data.plan;
    const subtasks: any[] = steps.map((s: string) => ({
      id: uuid(),
      name: s,
      done: false
    }));

    const newTask: Task = {
      id: uuid(),
      name: title,
      time: '',
      date: new Date().toISOString().split('T')[0],
      done: false,
      threadId: threadId,
      type: 'thought',
      subtasks
    };

    setTasks(prev => [...(Array.isArray(prev) ? prev : []), newTask]);
    db.saveTask(newTask);

    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data) {
          m.planning_data.status = 'accepted';
        }
        newMessages[msgIndex] = m;
        const updated = {
          ...t,
          messages: [...newMessages, {
            role: 'assistant' as const,
            content: 'Отлично! План добавлен в календарь. Ты найдешь его в списке задач со звездочкой.',
            time: ft()
          }]
        };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const handleRejectPlan = (msgIndex: number) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data) {
          m.planning_data.status = 'rejected';
        }
        newMessages[msgIndex] = m;
        const updated = {
          ...t,
          messages: [...newMessages, {
            role: 'assistant' as const,
            content: 'Хорошо, давай попробуем по-другому или просто продолжим общение.',
            time: ft()
          }]
        };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(34,34,36,0.08)' }}>
        <span style={{ fontFamily: M, fontSize: '15px', fontWeight: 600, color: '#222224', flex: 1 }}>{thread.title}</span>
        <div className="flex items-center gap-1 rounded-full p-1" style={{ background: '#f0f0f0' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#ffffff' }}>
            <MessageCircle size={16} strokeWidth={1.75} color="#222224" />
          </div>
          <button className="w-8 h-8 rounded-full flex items-center justify-center" onClick={() => alert('Заметки будут в ближайших обновлениях')}>
            <StickyNote size={16} strokeWidth={1.75} color="rgba(34,34,36,0.3)" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3 min-h-0">
        {visibleMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <span style={{ fontFamily: M, fontSize: '16px', color: 'rgba(34,34,36,0.22)', textAlign: 'center', lineHeight: 1.6 }}>
              Есть мысли?<br />Напиши сюда
            </span>
          </div>
        ) : (
          visibleMessages.map((m, i) => (
            <div key={i} className={`flex flex-col max-w-[72%] gap-1 ${m.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
              <div className="px-4 py-2.5" style={{
                fontSize: '14px', lineHeight: 1.6, fontFamily: M,
                background: m.role === 'user' ? '#222224' : '#ffffff',
                color: m.role === 'user' ? '#ffffff' : '#222224',
                borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              }}>
                {m.content}

                {m.planning_data && m.planning_data.status === 'questionnaire' && (
                  <div className="mt-3 flex flex-col gap-4">
                    {m.planning_data.questions.map((q: any) => {
                      const isAnswered = m.planning_data?.answers?.[q.id];
                      if (isAnswered) return (
                        <div key={q.id} style={{ background: 'rgba(34,34,36,0.06)', padding: '8px', borderRadius: '8px' }}>
                          <div style={{ fontSize: '11px', color: 'rgba(34,34,36,0.4)', marginBottom: '2px' }}>{q.question}</div>
                          <div style={{ fontSize: '13px', fontWeight: 600 }}>{isAnswered}</div>
                        </div>
                      );
                      return (
                        <div key={q.id} className="flex flex-col gap-2">
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#222224' }}>{q.question}</div>
                          <div className="flex flex-col gap-1">
                            {q.options.map((opt: string) => (
                              <button
                                key={opt}
                                onClick={() => handleDesktopAnswer(visibleMessages.indexOf(m), q.id, opt)}
                                style={{
                                  textAlign: 'left', padding: '8px 12px',
                                  background: 'rgba(34,34,36,0.06)', borderRadius: '10px',
                                  fontSize: '13px', color: '#222224', border: 'none', cursor: 'pointer',
                                }}
                              >
                                {opt}
                              </button>
                            ))}
                            <input
                              placeholder="Свой вариант..."
                              style={{
                                padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(34,34,36,0.12)',
                                fontSize: '13px', color: '#222224', background: 'rgba(34,34,36,0.03)', outline: 'none',
                              }}
                              onKeyDown={(e) => {
                                const val = (e.target as HTMLInputElement).value.trim();
                                if (e.key === 'Enter' && val) {
                                  handleDesktopAnswer(visibleMessages.indexOf(m), q.id, val);
                                }
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {m.planning_data?.status === 'plan_generated' && m.planning_data.plan && (
                  <div className="mt-3 rounded-[16px] p-3" style={{ background: 'rgba(34,34,36,0.04)', border: '1px solid rgba(34,34,36,0.08)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#222224', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ⭐ {m.planning_data.plan.title}
                    </div>
                    <div className="flex flex-col gap-3" style={{ marginBottom: '12px' }}>
                      {m.planning_data.plan.steps.map((step: string, sIdx: number) => (
                        <div key={sIdx} className="flex items-start gap-2">
                          <div style={{
                            width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(34,34,36,0.1)',
                            color: '#222224', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', fontWeight: 600, flexShrink: 0
                          }}>
                            {sIdx + 1}
                          </div>
                          <input
                            value={step}
                            onChange={(e) => updatePlanStep(visibleMessages.indexOf(m), sIdx, e.target.value)}
                            style={{
                              flex: 1, background: 'transparent', fontSize: '13px', color: '#222224',
                              outline: 'none', borderBottom: '1px solid rgba(34,34,36,0.1)', paddingBottom: '4px'
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptPlan(visibleMessages.indexOf(m))}
                        style={{
                          flex: 1, height: '36px', background: '#222224', color: '#ffffff',
                          borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer'
                        }}
                      >
                        Принять
                      </button>
                      <button
                        onClick={() => handleRejectPlan(visibleMessages.indexOf(m))}
                        style={{
                          flex: 1, height: '36px', background: 'rgba(34,34,36,0.06)', color: '#222224',
                          borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer'
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <span style={{ fontSize: '11px', color: 'rgba(34,34,36,0.3)', fontFamily: M }}>{m.time}</span>
            </div>
          ))
        )}
        {isTyping && (
          <div className="self-start flex gap-1.5 px-4 py-3 rounded-[16px] rounded-bl-[4px]" style={{ background: '#ffffff' }}>
            {[0, 0.15, 0.3].map((d, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'rgba(34,34,36,0.4)', animationDelay: `${d}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="px-6 pb-6 flex-shrink-0">
        <div className="rounded-[18px] p-4" style={{ background: '#ffffff' }}>
          <input
            className="w-full bg-transparent outline-none"
            style={{ fontFamily: M, fontSize: '15px', color: '#222224' }}
            placeholder="Есть мысли?"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          />
          <div className="flex items-center justify-between mt-3">
            <button className="w-8 h-8 flex items-center justify-center" onClick={() => alert('Вложения будут в ближайших обновлениях')}>
              <Plus size={20} strokeWidth={1.75} color="rgba(34,34,36,0.32)" />
            </button>
            <div className="flex items-center gap-2">
              <motion.button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all border ${
                  voiceState === 'recording'
                    ? 'bg-red-500 border-red-600'
                    : voiceState === 'processing'
                    ? 'bg-[#222224] border-[#222224]'
                    : 'bg-gray-200 border-gray-400 hover:bg-gray-300'
                }`}
                title={voiceState === 'recording' ? 'Отпустите для завершения' : 'Нажмите для записи'}
              >
                {voiceState === 'processing' ? (
                  <Loader size={18} strokeWidth={2} color="#ffffff" className="animate-spin" />
                ) : (
                  <Mic
                    size={18}
                    strokeWidth={2}
                    color={voiceState === 'recording' ? '#ffffff' : '#000000'}
                  />
                )}
              </motion.button>
              <button disabled={!input.trim() || isTyping} onClick={handleSend} className="w-10 h-10 rounded-full flex items-center justify-center transition-colors" style={{ background: input.trim() && !isTyping ? '#222224' : 'rgba(34,34,36,0.12)' }}>
                <ArrowUp size={18} strokeWidth={2} color="#ffffff" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadsPanel({
  threads, setThreads, tasks, setTasks, curTh, setCurTh, startNewThread,
  pendingMessage, onPendingConsumed,
}: {
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  curTh: string | null;
  setCurTh: (id: string | null) => void;
  startNewThread: () => void;
  pendingMessage: string | null;
  onPendingConsumed: () => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = threads.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase())
  );

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setThreads(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== id));
    await db.deleteThread(id);
    if (curTh === id) setCurTh(null);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-col flex-shrink-0" style={{ width: '280px', borderRight: '1px solid rgba(34,34,36,0.08)' }}>
        <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(34,34,36,0.08)' }}>
          <div className="h-9 rounded-full flex items-center gap-2 px-3" style={{ background: '#ffffff', border: '1px solid rgba(34,34,36,0.1)' }}>
            <Search size={14} strokeWidth={1.75} color="rgba(34,34,36,0.32)" />
            <input
              className="flex-1 bg-transparent outline-none"
              style={{ fontFamily: M, fontSize: '13px', color: '#222224' }}
              placeholder="Поиск мыслей..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10" style={{ color: 'rgba(34,34,36,0.25)', fontFamily: M, fontSize: '13px' }}>
              Нет мыслей.<br />Начни новую!
            </div>
          ) : (
            filtered.map(th => (
              <div
                key={th.id}
                onClick={() => setCurTh(th.id)}
                className="px-5 py-3.5 cursor-pointer transition-colors"
                style={{ background: curTh === th.id ? 'rgba(34,34,36,0.05)' : 'transparent', borderBottom: '1px solid rgba(34,34,36,0.06)' }}
              >
                <div style={{ fontFamily: M, fontSize: '14px', fontWeight: 600, color: '#222224', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {th.title}
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(34,34,36,0.42)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', fontFamily: M }}>
                  {th.preview || 'Нет сообщений'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {curTh ? (
          <DesktopChat
            key={curTh}
            threadId={curTh}
            threads={threads}
            setThreads={setThreads}
            tasks={tasks}
            setTasks={setTasks}
            onClose={() => setCurTh(null)}
            initialMessage={pendingMessage}
            onInitialConsumed={onPendingConsumed}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-5">
            <span style={{ fontFamily: M, fontSize: '16px', color: 'rgba(34,34,36,0.22)', textAlign: 'center', lineHeight: 1.6 }}>
              Выбери мысль слева<br />или начни новую
            </span>
            <button onClick={startNewThread} className="h-10 px-5 rounded-full flex items-center gap-2 transition-opacity hover:opacity-80" style={{ background: '#222224' }}>
              <PenLine size={15} strokeWidth={1.75} color="#ffffff" />
              <span style={{ fontFamily: M, fontSize: '13px', color: '#ffffff' }}>Новая мысль</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesktopApp({
  tasks, setTasks, threads, setThreads, settings, setSettings,
  screen, setScreen, curTh, setCurTh, startNewThread, handleLogout,
}: DesktopAppProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

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
    return (Array.isArray(tasks) ? tasks : [])
      .filter(t => (t.date || today) === selectedDate)
      .sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });
  }, [tasks, selectedDate, today]);

  const toggleTask = (id: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
  };

  const toggleSubtask = (taskId: string, subtaskId: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === taskId && t.subtasks) {
        const u = { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, done: !s.done } : s) };
        db.saveTask(u);
        return u;
      }
      return t;
    }));
  };

  const addTask = async (name: string, time: string, date: string) => {
    const t: Task = { id: uuid(), name, time, date, done: false };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setIsAddModalOpen(false);
  };

  const quickAddTask = async (name: string) => {
    const t: Task = { id: uuid(), name, time: '', date: selectedDate, done: false };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
  };

  const updateTask = async (id: string, name: string, time: string, date: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === id) { const u = { ...t, name, time, date }; db.saveTask(u); return u; }
      return t;
    }));
    setEditingTask(null);
  };

  const deleteTask = async (id: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== id));
    await db.deleteTask(id);
    setEditingTask(null);
  };

  const startNewThreadWithMessage = async (message: string) => {
    const newTh: Thread = {
      id: uuid(), title: 'Новая мысль', preview: message.slice(0, 60),
      messages: [], createdAt: Date.now(),
    };
    setThreads(prev => [...(Array.isArray(prev) ? prev : []), newTh]);
    await db.saveThread(newTh);
    setCurTh(newTh.id);
    setPendingMessage(message);
    setScreen('threads');
  };

  const isThreadsOrAI = screen === 'threads' || screen === 'ai';

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f0f0f0' }}>

      {/* ── Sidebar — новый дизайн ── */}
      <div
        className="flex flex-col flex-shrink-0 items-center"
        style={{
          width: '64px',
          background: '#ffffff',
          borderRight: '1px solid rgba(34,34,36,0.08)',
          padding: '20px 0',
        }}
      >
        {/* Logo */}
        <div className="mb-7">
          <LogoIcon size={26} />
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-1 flex-1 w-full px-2">
          <NavItem
            icon={<CalendarDays size={18} strokeWidth={1.75} />}
            label="Календарь"
            active={screen === 'dash'}
            onClick={() => setScreen('dash')}
          />
          <NavItem
            icon={<MessageCircle size={18} strokeWidth={1.75} />}
            label="Мысли"
            active={isThreadsOrAI}
            onClick={() => setScreen('threads')}
          />
        </nav>

        {/* New thread button */}
        <div className="mb-3 w-full px-2">
          <button
            onClick={startNewThread}
            title="Новая мысль"
            className="w-full h-10 rounded-[12px] flex items-center justify-center transition-opacity hover:opacity-75"
            style={{ background: '#222224' }}
          >
            <PenLine size={16} strokeWidth={1.75} color="#ffffff" />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'rgba(34,34,36,0.08)', width: '40px', marginBottom: '12px' }} />

        {/* Bottom nav */}
        <div className="flex flex-col gap-1 w-full px-2">
          <NavItem
            icon={<Settings size={18} strokeWidth={1.75} />}
            label="Настройки"
            active={screen === 'settings'}
            onClick={() => setScreen('settings')}
          />
          <button
            onClick={handleLogout}
            title="Выйти"
            className="w-11 h-11 rounded-[12px] flex items-center justify-center transition-colors hover:bg-[rgba(34,34,36,0.05)] mx-auto"
          >
            <LogOut size={18} strokeWidth={1.75} color="rgba(34,34,36,0.4)" />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {screen === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-hidden">
              <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen('dash')} onLogout={handleLogout} />
            </motion.div>
          )}
          {screen === 'dash' && (
            <motion.div key="dash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-hidden flex flex-col">
              <DashboardPanel
                weekDays={weekDays} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
                selectedDate={selectedDate} setSelectedDate={setSelectedDate} today={today}
                filteredTasks={filteredTasks} toggleTask={toggleTask} toggleSubtask={toggleSubtask}
                onAddTask={() => setIsAddModalOpen(true)} onEditTask={setEditingTask}
                onQuickAddTask={quickAddTask} onQuickChat={startNewThreadWithMessage}
              />
            </motion.div>
          )}
          {isThreadsOrAI && (
            <motion.div key="threads" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-hidden flex flex-col">
              <ThreadsPanel
                threads={threads} setThreads={setThreads} tasks={tasks} setTasks={setTasks}
                curTh={curTh} setCurTh={setCurTh} startNewThread={startNewThread}
                pendingMessage={pendingMessage} onPendingConsumed={() => setPendingMessage(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AddTaskModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addTask} initialDate={selectedDate} />
      <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onUpdate={updateTask} onDelete={deleteTask} onOpenThread={id => { setCurTh(id); setScreen('ai'); }} />
    </div>
  );
}
