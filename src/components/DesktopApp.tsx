import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sun, Calendar, MessageCircle, Settings as SettingsIcon,
  Plus, ChevronDown, ArrowUp, Search, Check, Mic, Loader,
  PanelLeftOpen, PanelLeftClose,
} from 'lucide-react';
import { Task, Thread, Settings as SettingsType, Screen } from '../types';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import SettingsScreen from './Settings';
import NoteView from './NoteView';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { useVoiceInput } from '../lib/useVoiceInput';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

const DAY_NAMES_RU = ['ВОСКРЕСЕНЬЕ','ПОНЕДЕЛЬНИК','ВТОРНИК','СРЕДА','ЧЕТВЕРГ','ПЯТНИЦА','СУББОТА'];
const WEEK_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const MONTH_SHORT = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmt2(n: number) { return n.toString().padStart(2, '0'); }
function formatDateCard(d: Date) {
  return `${fmt2(d.getDate())}.${fmt2(d.getMonth() + 1)}.${d.getFullYear().toString().slice(2)}`;
}
function nowTime() {
  const n = new Date();
  return `${fmt2(n.getHours())}:${fmt2(n.getMinutes())}`;
}

// Правка №1: контейнер 720px по центру
const CC: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
  padding: '0 24px',
};

// ─── Logo ──────────────────────────────────────────────────────────────────────

function LogoIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="123 -2 172 172" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="131.436" y="5.883" width="156.324" height="156.324" rx="78.162" stroke="#222224" strokeWidth="11.766"/>
      <path d="M260.026 84.047H159.172" stroke="#222224" strokeWidth="11.766"/>
      <path d="M233.37 60.273L185.827 107.816" stroke="#222224" strokeWidth="11.766"/>
      <path d="M233.371 107.816L185.828 60.273" stroke="#222224" strokeWidth="11.766"/>
      <path d="M209.599 134.473L209.599 33.619" stroke="#222224" strokeWidth="11.766"/>
    </svg>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

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

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const lines = text.split('\n');

  const parseInline = (line: string, key: number): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[2]) parts.push(<strong key={m.index}>{m[2]}</strong>);
      else if (m[3]) parts.push(<em key={m.index}>{m[3]}</em>);
      else if (m[4]) parts.push(<code key={m.index} style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.07)', borderRadius: 4, padding: '1px 5px', fontSize: '0.9em' }}>{m[4]}</code>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <React.Fragment key={key}>{parts}</React.Fragment>;
  };

  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    const bulletMatch = line.match(/^[-•]\s+(.*)$/);

    if (numMatch || bulletMatch) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const nm = l.match(/^(\d+)\.\s+(.*)$/);
        const bm = l.match(/^[-•]\s+(.*)$/);
        if (nm) { items.push(<li key={i}>{parseInline(nm[2], i)}</li>); i++; }
        else if (bm) { items.push(<li key={i}>{parseInline(bm[1], i)}</li>); i++; }
        else break;
      }
      nodes.push(numMatch
        ? <ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{items}</ol>
        : <ul key={`ul-${i}`} style={{ paddingLeft: 20, margin: '6px 0', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: 3 }}>{items}</ul>
      );
    } else if (line === '') {
      nodes.push(<br key={i} />);
      i++;
    } else {
      nodes.push(<span key={i} style={{ display: 'block' }}>{parseInline(line, i)}</span>);
      i++;
    }
  }

  return <div style={style}>{nodes}</div>;
}

// ─── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '4px 0' }}>
      {[0, 0.18, 0.36].map((delay, i) => (
        <div key={i} className="dot-bounce" style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--text-30)', animationDelay: `${delay}s`,
        }} />
      ))}
    </div>
  );
}

// ─── Chat input bar ────────────────────────────────────────────────────────────

function ChatInputBar({
  value, onChange, onSend, disabled, placeholder = 'Спрашивай о чём угодно',
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { state: voiceState, startRecording, stopRecording } = useVoiceInput((text) => {
    onChange(value ? value + ' ' + text : text);
  });

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + 'px';
    }
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;
  const isRecording = voiceState === 'recording';
  const isProcessing = voiceState === 'processing';

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-input)',
      borderRadius: 24,
      padding: '14px 16px 12px',
      boxShadow: 'var(--shadow-input)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <textarea
        ref={ref} rows={1} value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={isRecording ? 'Запись...' : isProcessing ? 'Обработка...' : placeholder}
        style={{
          fontFamily: M, fontSize: 15, color: 'var(--text-primary)',
          background: 'transparent', border: 'none', outline: 'none',
          resize: 'none', width: '100%', lineHeight: 1.55,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
          onClick={() => alert('Вложения — скоро')}>
          <Plus size={20} strokeWidth={1.5} color="var(--text-30)" />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.button
            onPointerDown={e => { e.preventDefault(); startRecording(); }}
            onPointerUp={e => { e.preventDefault(); stopRecording(); }}
            onPointerCancel={stopRecording}
            title={isRecording ? 'Отпусти для завершения' : 'Удерживай для записи'}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isRecording ? '#c0392b' : isProcessing ? 'var(--accent)' : 'rgba(9,14,23,0.08)',
              transition: 'background 0.15s',
            }}
          >
            {isProcessing
              ? <Loader size={15} strokeWidth={2} color="#fff" className="animate-spin" />
              : <Mic size={15} strokeWidth={1.75} color={isRecording ? '#fff' : 'var(--text-40)'} />
            }
          </motion.button>
          <button onClick={onSend} disabled={!canSend} style={{
            width: 36, height: 36, borderRadius: '50%',
            background: canSend ? 'var(--accent)' : 'rgba(9,14,23,0.1)',
            border: 'none', cursor: canSend ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s', flexShrink: 0,
          }}>
            <ArrowUp size={16} strokeWidth={2} color="var(--accent-text)" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task row with subtasks ────────────────────────────────────────────────────

function TaskRow({
  task, onToggle, onToggleSubtask, onClick,
}: {
  task: Task;
  onToggle: () => void;
  onToggleSubtask?: (subId: string) => void;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSubs = Boolean(task.subtasks?.length);

  return (
    <div>
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', cursor: 'pointer' }}>
        <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${task.done ? 'var(--text-primary)' : 'var(--text-30)'}`,
          background: task.done ? 'var(--text-primary)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s',
        }}>
          {task.done && <Check size={10} color="#fff" strokeWidth={2.5} />}
        </button>
        <span style={{
          fontFamily: M, fontSize: 14, flex: 1,
          color: task.done ? 'var(--text-30)' : 'var(--text-primary)',
          textDecoration: task.done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.name}</span>
        {task.time && <span style={{ fontFamily: M, fontSize: 14, color: 'var(--text-30)', flexShrink: 0 }}>{task.time}</span>}
        {hasSubs && (
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', color: 'var(--text-30)', flexShrink: 0,
          }}>
            <ChevronDown size={14} strokeWidth={1.75} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
          </button>
        )}
      </div>
      {hasSubs && expanded && (
        <div style={{ paddingLeft: 54, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {task.subtasks!.map(sub => (
            <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => onToggleSubtask?.(sub.id)} style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `1.5px solid ${sub.done ? 'var(--text-primary)' : 'var(--text-30)'}`,
                background: sub.done ? 'var(--text-primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {sub.done && <Check size={8} color="#fff" strokeWidth={2.5} />}
              </button>
              <span style={{
                fontFamily: M, fontSize: 13,
                color: sub.done ? 'var(--text-30)' : 'var(--text-muted)',
                textDecoration: sub.done ? 'line-through' : 'none',
              }}>{sub.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Thread dropdown menu (правка №4) ─────────────────────────────────────────

function ThreadMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-30)', fontSize: 18, lineHeight: 1,
          padding: '2px 4px', letterSpacing: 1,
        }}
      >
        ···
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)',
          background: 'var(--surface)',
          border: '1px solid var(--border-input)',
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          zIndex: 50,
          minWidth: 130,
          overflow: 'hidden',
        }}>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); setOpen(false); }}
            style={{
              width: '100%', display: 'block', background: 'none', border: 'none',
              padding: '10px 16px', textAlign: 'left', cursor: 'pointer',
              fontFamily: M, fontSize: 14, color: '#c0392b',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Today screen ──────────────────────────────────────────────────────────────

function TodayScreen({
  tasks, setTasks, onQuickChat, onAddTask, onEditTask,
}: {
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  onQuickChat: (msg: string) => void;
  onAddTask: () => void;
  onEditTask: (t: Task) => void;
}) {
  const [chatInput, setChatInput] = useState('');
  const today = todayStr();
  const now = new Date();

  const todayTasks = useMemo(() =>
    (Array.isArray(tasks) ? tasks : [])
      .filter(t => (t.date || today) === today)
      .sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      }),
    [tasks, today]
  );

  const toggleTask = (id: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
  };

  const toggleSubtask = (taskId: string, subId: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== taskId) return t;
      const u = { ...t, subtasks: t.subtasks?.map(s => s.id === subId ? { ...s, done: !s.done } : s) };
      db.saveTask(u);
      return u;
    }));
  };

  const handleChat = () => {
    if (!chatInput.trim()) return;
    onQuickChat(chatInput.trim());
    setChatInput('');
  };

  const taskWord = (n: number) => {
    if (n % 10 === 1 && n % 100 !== 11) return 'дело';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дела';
    return 'дел';
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 20 }}>
      <div style={{ ...CC }}>
        {/* Date & day */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)', letterSpacing: '0.04em', marginBottom: 6 }}>
            {formatDateCard(now)}
          </div>
          <div style={{ fontFamily: F, fontSize: 34, color: 'var(--text-80)', lineHeight: 1 }}>
            {DAY_NAMES_RU[now.getDay()]}
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 20,
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 9l5-5 5 5" stroke="var(--text-40)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontFamily: M, fontSize: 14, color: 'var(--text-80)' }}>
                {todayTasks.length > 0 ? `Ещё ${todayTasks.length} ${taskWord(todayTasks.length)}` : 'Нет дел на сегодня'}
              </span>
            </div>
            <button onClick={onAddTask} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
              <Plus size={18} strokeWidth={1.75} color="var(--text-40)" />
            </button>
          </div>

          {todayTasks.map((task, idx) => (
            <div key={task.id} style={{ borderBottom: idx < todayTasks.length - 1 ? '1px solid var(--border)' : undefined }}>
              <TaskRow
                task={task}
                onToggle={() => toggleTask(task.id)}
                onToggleSubtask={(subId) => toggleSubtask(task.id, subId)}
                onClick={() => onEditTask(task)}
              />
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', padding: '13px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChat()}
                placeholder="Спрашивай о чём угодно"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 14, color: 'var(--text-primary)' }} />
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                onClick={() => alert('Голосовой ввод — скоро')}>
                <Mic size={17} strokeWidth={1.5} color="var(--text-30)" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Empty chat screen ──────────────────────────────────────────────────────────

function EmptyChatScreen({ onSend }: { onSend: (msg: string) => void }) {
  const [input, setInput] = useState('');
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
        <div style={{ ...CC, textAlign: 'center' }}>
          <div style={{ fontFamily: F, fontSize: 36, color: 'var(--text-80)', marginBottom: 32 }}>
            есть мысли?
          </div>
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={() => { if (input.trim()) { onSend(input.trim()); setInput(''); } }}
            placeholder="Спрашивай о чём угодно"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Chat view ──────────────────────────────────────────────────────────────────

function ChatView({
  threadId, threads, setThreads, tasks, setTasks, initialMessage, onInitialConsumed,
}: {
  key?: React.Key;
  threadId: string;
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  initialMessage?: string | null;
  onInitialConsumed?: () => void;
}) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoSend = useRef(false);

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

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setInput('');

    const userMsg = { role: 'user' as const, content: text, time: nowTime() };
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

      let history = [...current.messages, userMsg];
      const turnMsgs: typeof history = [];
      let response = await generateResponse(history);

      while (response.tool_calls) {
        const toolResults: typeof history = [];
        const assistantMsg = { role: 'assistant' as const, content: response.content || '', tool_calls: response.tool_calls, time: nowTime() };
        turnMsgs.push(assistantMsg);

        for (const call of response.tool_calls) {
          const { name } = call.function;
          const args = JSON.parse(call.function.arguments);
          let result: any;

          if (name === 'get_tasks') {
            const filtered = args.date ? tasks.filter(t => t.date === args.date) : tasks;
            result = filtered.length > 0 ? filtered : 'Задач не найдено.';
          } else if (name === 'add_task') {
            const newTask: Task = { id: uuid(), name: args.name, time: args.time || '', date: args.date || todayStr(), done: false, threadId };
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
            const planningMsg = {
              role: 'assistant' as const,
              content: 'Чтобы составить лучший план, мне нужно уточнить пару деталей:',
              time: nowTime(),
              planning_data: { questions: args.questions, status: 'questionnaire' as const },
            };
            setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
              if (t.id === threadId) { const u = { ...t, messages: [...t.messages, planningMsg] }; db.saveThread(u); return u; }
              return t;
            }));
            setIsTyping(false);
            return;
          }

          toolResults.push({ role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(result ?? { status: 'ok' }), time: nowTime() });
        }

        turnMsgs.push(...toolResults);
        history = [...history, assistantMsg, ...toolResults];
        response = await generateResponse(history);
      }

      const finalMsg = { role: 'assistant' as const, content: response.content || 'Готово!', time: nowTime() };
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
      const errMsg = { role: 'assistant' as const, content: `Ошибка: ${err.message || 'Не удалось связаться с ИИ.'}`, time: nowTime() };
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
        if (t.id === threadId) { const u = { ...t, messages: [...t.messages, errMsg] }; db.saveThread(u); return u; }
        return t;
      }));
    } finally {
      setIsTyping(false);
    }
  };

  const handleAnswer = (questionId: string, answer: string) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== threadId) return t;
      const msgs = [...t.messages];
      const idx = msgs.findIndex(m => m.planning_data?.status === 'questionnaire');
      if (idx === -1) return t;
      const msg = { ...msgs[idx] };
      if (msg.planning_data) {
        msg.planning_data = { ...msg.planning_data, answers: { ...msg.planning_data.answers, [questionId]: answer } };
        const allAnswered = msg.planning_data.questions.every((q: any) => msg.planning_data?.answers?.[q.id]);
        if (allAnswered) {
          msg.planning_data.status = 'plan_generated';
          setTimeout(() => generatePlan(t, msg.planning_data!), 100);
        }
      }
      msgs[idx] = msg;
      const u = { ...t, messages: msgs };
      db.saveThread(u);
      return u;
    }));
  };

  const generatePlan = async (t: Thread, planningData: any) => {
    setIsTyping(true);
    try {
      const answersText = Object.entries(planningData.answers)
        .map(([id, ans]) => {
          const q = planningData.questions.find((q: any) => q.id === id);
          return `Вопрос: ${q?.question}\nОтвет: ${ans}`;
        }).join('\n\n');
      const prompt = `Пользователь ответил на уточняющие вопросы:\n\n${answersText}\n\nНа основе этих ответов составь пошаговый план действий.\nОтвечай СТРОГО в формате JSON:\n{\n  "title": "Название плана",\n  "steps": ["шаг 1", "шаг 2", ...]\n}`;
      const response = await generateResponse([...t.messages, { role: 'user', content: prompt, time: nowTime() }], { tool_choice: 'none' } as any);
      if (!response?.content) throw new Error('Пустой ответ');
      let json = response.content.trim();
      if (json.includes('```json')) json = json.split('```json')[1].split('```')[0].trim();
      else if (json.includes('```')) json = json.split('```')[1].split('```')[0].trim();
      const plan = JSON.parse(json);
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(th => {
        if (th.id !== threadId) return th;
        const msgs = [...th.messages];
        const idx = msgs.findIndex(m => m.planning_data?.status === 'plan_generated');
        if (idx === -1) return th;
        const m = { ...msgs[idx] };
        if (m.planning_data) m.planning_data = { ...m.planning_data, plan, status: 'plan_generated' };
        msgs[idx] = m;
        const u = { ...th, messages: msgs };
        db.saveThread(u);
        return u;
      }));
    } catch (e) {
      console.error('Plan generation error:', e);
    } finally {
      setIsTyping(false);
    }
  };

  const updatePlanStep = (msgIdx: number, stepIdx: number, val: string) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== threadId) return t;
      const msgs = [...t.messages];
      const m = { ...msgs[msgIdx] };
      if (m.planning_data?.plan) {
        const steps = [...m.planning_data.plan.steps];
        steps[stepIdx] = val;
        m.planning_data = { ...m.planning_data, plan: { ...m.planning_data.plan, steps } };
      }
      msgs[msgIdx] = m;
      const u = { ...t, messages: msgs };
      db.saveThread(u);
      return u;
    }));
  };

  const acceptPlan = (msgIdx: number) => {
    const msg = thread.messages[msgIdx];
    if (!msg.planning_data?.plan) return;
    const { title, steps } = msg.planning_data.plan;
    const newTask: Task = {
      id: uuid(), name: title, time: '', date: todayStr(), done: false,
      threadId, type: 'thought',
      subtasks: steps.map((s: string) => ({ id: uuid(), name: s, done: false })),
    };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), newTask]);
    db.saveTask(newTask);
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== threadId) return t;
      const msgs = [...t.messages];
      const m = { ...msgs[msgIdx] };
      if (m.planning_data) m.planning_data = { ...m.planning_data, status: 'accepted' };
      msgs[msgIdx] = m;
      const u = { ...t, messages: [...msgs, { role: 'assistant' as const, content: 'Отлично! План добавлен в список задач.', time: nowTime() }] };
      db.saveThread(u);
      return u;
    }));
  };

  const rejectPlan = (msgIdx: number) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== threadId) return t;
      const msgs = [...t.messages];
      const m = { ...msgs[msgIdx] };
      if (m.planning_data) m.planning_data = { ...m.planning_data, status: 'rejected' };
      msgs[msgIdx] = m;
      const u = { ...t, messages: [...msgs, { role: 'assistant' as const, content: 'Хорошо, давай попробуем по-другому.', time: nowTime() }] };
      db.saveThread(u);
      return u;
    }));
  };

  const visible = thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingTop: 32, paddingBottom: 16 }}>
        <div style={{ ...CC, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {visible.map((m, i) => {
            const realIdx = thread.messages.indexOf(m);
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: m.role === 'user' ? '80%' : '100%',
                width: m.role === 'user' ? undefined : '100%',
                gap: 5,
              }}>
                {m.role === 'user' ? (
                  <div style={{ background: 'rgba(9,14,23,0.06)', borderRadius: 20, padding: '10px 16px', fontFamily: M, fontSize: 15, color: 'var(--text-80)', lineHeight: 1.6 }}>
                    {m.content}
                  </div>
                ) : (
                  <div style={{ width: '100%' }}>
                    <MarkdownText text={m.content} style={{ fontFamily: M, fontSize: 15, color: 'var(--text-80)', lineHeight: 1.75 }} />

                    {/* Planning: questionnaire */}
                    {m.planning_data?.status === 'questionnaire' && (
                      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {m.planning_data.questions.map((q: any) => {
                          const answered = m.planning_data?.answers?.[q.id];
                          if (answered) return (
                            <div key={q.id} style={{ background: 'rgba(0,0,0,0.04)', padding: '8px 12px', borderRadius: 10 }}>
                              <div style={{ fontFamily: M, fontSize: 11, color: 'var(--text-30)', marginBottom: 2 }}>{q.question}</div>
                              <div style={{ fontFamily: M, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{answered}</div>
                            </div>
                          );
                          return (
                            <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ fontFamily: M, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{q.question}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {q.options.map((opt: string) => (
                                  <button key={opt} onClick={() => handleAnswer(q.id, opt)} style={{
                                    textAlign: 'left', padding: '8px 14px',
                                    background: 'rgba(0,0,0,0.04)', borderRadius: 10,
                                    fontFamily: M, fontSize: 13, color: 'var(--text-primary)',
                                    border: '1px solid var(--border)', cursor: 'pointer',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.08)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                                  >{opt}</button>
                                ))}
                                <input placeholder="Свой вариант..." onKeyDown={e => {
                                  const val = (e.target as HTMLInputElement).value.trim();
                                  if (e.key === 'Enter' && val) handleAnswer(q.id, val);
                                }} style={{
                                  padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border-input)',
                                  fontFamily: M, fontSize: 13, color: 'var(--text-primary)',
                                  background: 'transparent', outline: 'none',
                                }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Planning: plan generated */}
                    {m.planning_data?.status === 'plan_generated' && m.planning_data.plan && (
                      <div style={{ marginTop: 16, borderRadius: 16, padding: 16, background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border)' }}>
                        <div style={{ fontFamily: M, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                          ⭐ {m.planning_data.plan.title}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                          {m.planning_data.plan.steps.map((step: string, sIdx: number) => (
                            <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: M, fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{sIdx + 1}</div>
                              <input value={step} onChange={e => updatePlanStep(realIdx, sIdx, e.target.value)} style={{ flex: 1, background: 'transparent', fontFamily: M, fontSize: 13, color: 'var(--text-primary)', outline: 'none', borderBottom: '1px solid var(--border-input)', paddingBottom: 3 }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => acceptPlan(realIdx)} style={{ flex: 1, height: 36, background: 'var(--accent)', color: 'var(--accent-text)', borderRadius: 10, fontFamily: M, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Принять</button>
                          <button onClick={() => rejectPlan(realIdx)} style={{ flex: 1, height: 36, background: 'rgba(0,0,0,0.06)', color: 'var(--text-primary)', borderRadius: 10, fontFamily: M, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Отмена</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <span style={{ fontFamily: M, fontSize: 11, color: 'var(--text-30)' }}>{m.time}</span>
              </div>
            );
          })}
          {isTyping && <div style={{ alignSelf: 'flex-start' }}><TypingDots /></div>}
        </div>
      </div>

      <div style={{ padding: '0 0 32px', flexShrink: 0 }}>
        <div style={{ ...CC }}>
          <ChatInputBar value={input} onChange={setInput} onSend={() => sendMessage(input)} disabled={isTyping} placeholder="Задай уточняющий вопрос" />
        </div>
      </div>
    </div>
  );
}

// ─── Threads view ──────────────────────────────────────────────────────────────

function NoteTag({ label }: { label: string }) {
  return (
    <span style={{
      fontFamily: M, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      padding: '3px 8px', borderRadius: 40,
      background: 'rgba(0,0,0,0.05)', color: 'var(--text-30)',
      flexShrink: 0,
    }}>{label}</span>
  );
}

function ThreadsView({
  threads, setThreads, startNewThread, onOpenThread, onOpenNote,
}: {
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  startNewThread: () => void;
  onOpenThread: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'thoughts' | 'notes'>('thoughts');

  const all = Array.isArray(threads) ? threads : [];
  const thoughts = all.filter(t => t.source !== 'text');
  const notes = all;

  const applySearch = (list: Thread[]) => list.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase())
  );

  const displayed = tab === 'thoughts' ? applySearch(thoughts) : applySearch(notes);

  const deleteThread = async (id: string) => {
    setThreads(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  const handleRowClick = (th: Thread) => {
    if (tab === 'notes') onOpenNote(th.id);
    else onOpenThread(th.id);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ ...CC, paddingTop: 40, paddingBottom: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.05)', borderRadius: 40, padding: 4, gap: 2 }}>
            {([['thoughts', 'ТВОИ МЫСЛИ'], ['notes', 'ЗАМЕТКИ']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                fontFamily: M, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
                padding: '6px 14px', borderRadius: 40, border: 'none', cursor: 'pointer',
                background: tab === key ? 'var(--surface)' : 'transparent',
                color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.15s',
                boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={startNewThread} style={{
            fontFamily: M, fontSize: 13, letterSpacing: '0.06em',
            color: 'var(--text-primary)', background: 'none', border: 'none',
            cursor: 'pointer', textTransform: 'uppercase' as const, padding: 0,
          }}>
            НОВАЯ МЫСЛЬ
          </button>
        </div>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.04)', borderRadius: 40, padding: '10px 16px', marginBottom: 8 }}>
          <Search size={15} strokeWidth={1.75} color="var(--text-30)" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'thoughts' ? 'Поиск по архиву мыслей' : 'Поиск по заметкам'}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 14, color: 'var(--text-primary)' }} />
        </div>

        {/* List */}
        {displayed.length === 0 ? (
          <div style={{ padding: '40px 0', fontFamily: M, fontSize: 14, color: 'var(--text-30)', textAlign: 'center' }}>
            {search ? 'Ничего не найдено' : tab === 'thoughts' ? 'Мыслей пока нет' : 'Заметок пока нет'}
          </div>
        ) : (
          displayed.map(th => (
            <div key={th.id} onClick={() => handleRowClick(th)} style={{
              padding: '16px 0',
              borderTop: '1px solid var(--border)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{
                    fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {th.title}
                  </div>
                  {tab === 'notes' && <NoteTag label={th.source === 'text' ? 'Текст' : 'Мысль'} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    fontFamily: M, fontSize: 13, color: 'var(--text-muted)', flex: 1,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden', lineHeight: 1.5,
                  }}>
                    {th.preview || 'Нет сообщений'}
                  </div>
                  <span style={{ fontFamily: M, fontSize: 12, color: 'var(--text-30)', flexShrink: 0 }}>
                    {new Date(th.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </div>
              <ThreadMenu onDelete={() => deleteThread(th.id)} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Calendar view ─────────────────────────────────────────────────────────────

function CalendarView({
  tasks, setTasks, onAddTask, onEditTask,
}: {
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  onAddTask: () => void;
  onEditTask: (t: Task) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const today = todayStr();

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

  const filteredTasks = useMemo(() =>
    (Array.isArray(tasks) ? tasks : [])
      .filter(t => (t.date || today) === selectedDate)
      .sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      }),
    [tasks, selectedDate, today]
  );

  const toggleTask = (id: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; }
      return t;
    }));
  };

  const toggleSubtask = (taskId: string, subId: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== taskId) return t;
      const u = { ...t, subtasks: t.subtasks?.map(s => s.id === subId ? { ...s, done: !s.done } : s) };
      db.saveTask(u);
      return u;
    }));
  };

  const month = MONTH_SHORT[weekDays[3].getMonth()];
  const year = weekDays[3].getFullYear();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ ...CC, paddingTop: 32, paddingBottom: 32 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontFamily: F, fontSize: 13, color: 'var(--text-30)' }}>{year}</div>
                <div style={{ fontFamily: F, fontSize: 30, color: 'var(--text-80)', lineHeight: 1.1 }}>{month}</div>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={() => setWeekOffset(v => v - 1)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 11L5 7l4-4" stroke="var(--text-40)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button onClick={() => setWeekOffset(v => v + 1)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="var(--text-40)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
            <button onClick={onAddTask} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent)', border: 'none', borderRadius: 40, padding: '8px 18px', cursor: 'pointer' }}>
              <Plus size={14} strokeWidth={2} color="var(--accent-text)" />
              <span style={{ fontFamily: M, fontSize: 13, color: 'var(--accent-text)' }}>Добавить</span>
            </button>
          </div>

          <div style={{ height: 1, background: 'var(--border)', marginBottom: 4 }} />

          {/* Week row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {weekDays.map((d, i) => {
              const ds = d.toISOString().split('T')[0];
              const isSelected = ds === selectedDate;
              const isToday = ds === today;
              return (
                <button key={ds} onClick={() => setSelectedDate(ds)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 4px', borderRadius: 12, border: 'none', background: 'transparent', cursor: 'pointer' }}>
                  <span style={{ fontFamily: "'Russisch Sans', 'Muller', sans-serif", fontSize: 12, fontWeight: 600, color: 'var(--text-30)', letterSpacing: '0.02em' }}>{WEEK_DAYS[i]}</span>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: isSelected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 16, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", fontWeight: isToday && !isSelected ? 700 : 400, color: isSelected ? '#fff' : isToday ? 'var(--text-primary)' : 'var(--text-80)' }}>
                      {d.getDate()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

          {/* Tasks */}
          {filteredTasks.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: M, fontSize: 14, color: 'var(--text-30)' }}>Нет задач на этот день</div>
          ) : (
            filteredTasks.map((task, idx) => (
              <div key={task.id} style={{ borderBottom: idx < filteredTasks.length - 1 ? '1px solid var(--border)' : undefined }}>
                <TaskRow
                  task={task}
                  onToggle={() => toggleTask(task.id)}
                  onToggleSubtask={(subId) => toggleSubtask(task.id, subId)}
                  onClick={() => onEditTask(task)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  collapsed, onToggle, screen, setScreen, calActive, setCalActive, threads, startNewThread, onOpenNote, onDropText,
}: {
  collapsed: boolean;
  onToggle: () => void;
  screen: Screen;
  setScreen: (s: Screen) => void;
  calActive: boolean;
  setCalActive: (v: boolean) => void;
  threads: Thread[];
  startNewThread: () => void;
  onOpenNote: (id: string) => void;
  onDropText: (text: string) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(true);

  // Правка №5: серый active вместо чёрного
  const NavBtn = ({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) => {
    const [hovered, setHovered] = useState(false);
    return (
      <button
        onClick={onClick}
        title={collapsed ? label : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: collapsed ? 0 : 10,
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '7px 0' : '7px 14px',
          borderRadius: 40, border: 'none', cursor: 'pointer',
          background: active ? '#f0f0f0' : hovered ? '#f7f7f7' : 'transparent',
          color: active ? '#111' : '#888',
          fontWeight: active ? 500 : 400,
          transition: 'background 0.12s, color 0.12s',
          minHeight: 36, flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        {!collapsed && (
          <span style={{ fontFamily: M, fontSize: 15, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', fontWeight: 'inherit' }}>
            {label}
          </span>
        )}
      </button>
    );
  };

  const [dragOver, setDragOver] = useState(false);
  const [dropHovered, setDropHovered] = useState(false);

  const recentThreads = (Array.isArray(threads) ? threads : [])
    .slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);

  return (
    <motion.div
      animate={{ width: collapsed ? 52 : 190 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      style={{
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', flexShrink: 0, height: '100%',
      }}
    >
      {/* Правка №7: при свёрнутом — только кнопка разворачивания, без лого */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '18px 0' : '18px 12px 18px 16px',
        flexShrink: 0,
      }}>
        {collapsed ? (
          <button onClick={onToggle} title="Развернуть" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-40)' }}>
            <PanelLeftOpen size={18} strokeWidth={1.5} />
          </button>
        ) : (
          <>
            <LogoIcon size={28} />
            <button onClick={onToggle} title="Свернуть" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-30)', flexShrink: 0 }}>
              <PanelLeftClose size={18} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav style={{ padding: collapsed ? '0 6px' : '0 8px', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <button
          onClick={startNewThread}
          title={collapsed ? 'Новый чат' : undefined}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '7px 0' : '7px 14px',
            borderRadius: 40, border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#888', minHeight: 36, flexShrink: 0,
          }}
        >
          <Plus size={17} strokeWidth={1.75} color="#888" />
          {!collapsed && <span style={{ fontFamily: M, fontSize: 15, color: '#888' }}>Новый чат</span>}
        </button>

        <NavBtn
          icon={<Sun size={17} strokeWidth={1.75} />} label="Сегодня"
          active={screen === 'dash' && !calActive}
          onClick={() => { setScreen('dash'); setCalActive(false); }}
        />
        {/* Правка №3: Календарь теперь реально переключает вид */}
        <NavBtn
          icon={<Calendar size={17} strokeWidth={1.75} />} label="Календарь"
          active={screen === 'dash' && calActive}
          onClick={() => { setScreen('dash'); setCalActive(true); }}
        />
        <NavBtn
          icon={<MessageCircle size={17} strokeWidth={1.75} />} label="Твои мысли"
          active={screen === 'threads' || screen === 'ai'}
          onClick={() => setScreen('threads')}
        />
      </nav>

      {/* Notes section */}
      {!collapsed && recentThreads.length > 0 && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          <button onClick={() => setNotesOpen(v => !v)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 12px 4px 22px',
            background: 'none', border: 'none', cursor: 'pointer', width: '100%', flexShrink: 0,
          }}>
            <span style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)' }}>Заметки</span>
            <ChevronDown size={13} strokeWidth={1.75} color="var(--text-30)"
              style={{ transform: notesOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
          </button>
          {notesOpen && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px' }}>
              {recentThreads.map(th => (
                <div key={th.id} onClick={() => onOpenNote(th.id)} style={{
                  fontFamily: M, fontSize: 13, color: 'var(--text-muted)',
                  padding: '4px 12px', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', cursor: 'pointer', borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                title={th.title}
                onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f7')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {th.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spacer — заполняет пространство когда notes-секция не рендерится */}
      {(collapsed || recentThreads.length === 0) && <div style={{ flex: 1 }} />}

      {/* Drag & drop catch zone */}
      <div
        onMouseEnter={() => setDropHovered(true)}
        onMouseLeave={() => setDropHovered(false)}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
          if (text.trim()) onDropText(text.trim());
        }}
        style={{
          margin: collapsed ? '0 6px 10px' : '0 8px 10px',
          borderRadius: 10,
          border: `1.5px dashed ${dragOver ? 'var(--text-primary)' : dropHovered ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.12)'}`,
          background: dragOver ? 'rgba(0,0,0,0.04)' : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4,
          minHeight: 72, cursor: 'default',
        }}
      >
        <span style={{ fontFamily: M, fontSize: 20, color: dragOver ? 'var(--text-primary)' : dropHovered ? 'var(--text-30)' : 'var(--text-ultra)', lineHeight: 1, transition: 'color 0.15s' }}>+</span>
        {!collapsed && (dropHovered || dragOver) && (
          <span style={{ fontFamily: M, fontSize: 11, color: dragOver ? 'var(--text-primary)' : 'var(--text-30)', textAlign: 'center', lineHeight: 1.4, padding: '0 6px', transition: 'color 0.15s' }}>
            {dragOver ? 'Отпусти — создастся заметка' : 'Перетащи сюда любой текст'}
          </span>
        )}
      </div>

      {/* Settings */}
      <div style={{ padding: collapsed ? '10px 6px 18px' : '10px 8px 18px' }}>
        <NavBtn icon={<SettingsIcon size={17} strokeWidth={1.75} />} label="Настройки" active={screen === 'settings'} onClick={() => setScreen('settings')} />
      </div>
    </motion.div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────────

export default function DesktopApp({
  tasks, setTasks, threads, setThreads, settings, setSettings,
  screen, setScreen, curTh, setCurTh, startNewThread, handleLogout,
}: DesktopAppProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [calActive, setCalActive] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const addTask = async (name: string, time: string, date: string) => {
    const t: Task = { id: uuid(), name, time, date, done: false };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setIsAddModalOpen(false);
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
    const newTh: Thread = { id: uuid(), title: 'Новая мысль', preview: message.slice(0, 60), messages: [], createdAt: Date.now() };
    setThreads(prev => [...(Array.isArray(prev) ? prev : []), newTh]);
    await db.saveThread(newTh);
    setCurTh(newTh.id);
    setPendingMessage(message);
    setScreen('ai');
  };

  const handleStartNewThread = () => {
    startNewThread();
    setScreen('ai');
  };

  const handleOpenThread = (id: string) => {
    setCurTh(id);
    setNoteMode(false);
    setScreen('ai');
  };

  const handleOpenNote = (id: string) => {
    setCurTh(id);
    setNoteMode(true);
    setScreen('ai');
  };

  const handleDropText = async (text: string) => {
    const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
    const title = words.length < text.trim().length ? words + '…' : words;
    const newTh: Thread = {
      id: uuid(),
      title,
      preview: text.slice(0, 60),
      messages: [{ role: 'user', content: text, time: nowTime() }],
      createdAt: Date.now(),
      source: 'text',
    };
    setThreads(prev => [newTh, ...(Array.isArray(prev) ? prev : [])]);
    await db.saveThread(newTh);
    handleOpenNote(newTh.id);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
        screen={screen}
        setScreen={setScreen}
        calActive={calActive}
        setCalActive={setCalActive}
        threads={threads}
        startNewThread={handleStartNewThread}
        onOpenNote={handleOpenNote}
        onDropText={handleDropText}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AnimatePresence mode="wait">

          {screen === 'dash' && !calActive && (
            <motion.div key="today" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <TodayScreen tasks={tasks} setTasks={setTasks} onQuickChat={startNewThreadWithMessage} onAddTask={() => setIsAddModalOpen(true)} onEditTask={setEditingTask} />
            </motion.div>
          )}

          {screen === 'dash' && calActive && (
            <motion.div key="cal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <CalendarView tasks={tasks} setTasks={setTasks} onAddTask={() => setIsAddModalOpen(true)} onEditTask={setEditingTask} />
            </motion.div>
          )}

          {screen === 'ai' && (
            <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {curTh && noteMode ? (
                <NoteView
                  threadId={curTh}
                  threads={threads}
                  setThreads={setThreads}
                  tasks={tasks}
                  onSwitchToChat={() => handleOpenThread(curTh)}
                />
              ) : curTh ? (
                <ChatView
                  key={curTh}
                  threadId={curTh}
                  threads={threads}
                  setThreads={setThreads}
                  tasks={tasks}
                  setTasks={setTasks}
                  initialMessage={pendingMessage}
                  onInitialConsumed={() => setPendingMessage(null)}
                />
              ) : (
                <EmptyChatScreen onSend={startNewThreadWithMessage} />
              )}
            </motion.div>
          )}

          {screen === 'threads' && (
            <motion.div key="threads" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <ThreadsView
                threads={threads}
                setThreads={setThreads}
                startNewThread={handleStartNewThread}
                onOpenThread={handleOpenThread}
                onOpenNote={handleOpenNote}
              />
            </motion.div>
          )}

          {screen === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen('dash')} onLogout={handleLogout} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <AddTaskModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addTask} initialDate={todayStr()} />
      <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onUpdate={updateTask} onDelete={deleteTask} onOpenThread={id => { setCurTh(id); setScreen('ai'); }} />
    </div>
  );
}
