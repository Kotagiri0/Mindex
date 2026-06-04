import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MysliThinking } from './MysliThinking';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sun, Calendar, MessageCircle, Settings as SettingsIcon,
  Plus, ChevronDown, ArrowUp, Search, Check, Mic, Loader,
  PanelLeftOpen, PanelLeftClose, Pencil, Copy, MoreHorizontal, X, StickyNote, BookOpen, ChevronRight,
  LayoutList, CalendarRange,
} from 'lucide-react';
import { Task, Thread, Message, Settings as SettingsType, Screen } from '../types';
import AddTaskModal from './AddTaskModal';
import TaskDetailPanel, { TaskCreatePatch } from './TaskDetailPanel';
import { TaskEditPatch } from './EditTaskModal';
import DayTimeline from './DayTimeline';
import TimelineCreatePopover from './TimelineCreatePopover';
import * as MxIcon from './icons';
import SettingsScreen from './Settings';
import NoteView from './NoteView';
import NoteEditor from './NoteEditor';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { getCurrentUser, apiFetch } from '../lib/auth';
import { useVoiceInput } from '../lib/useVoiceInput';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

const DAY_NAMES_RU = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const WEEK_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const MONTH_SHORT = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

function dateToStr(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function todayStr() { return dateToStr(new Date()); }
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
  const { state: voiceState, toggleRecording } = useVoiceInput((text) => {
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
          {canSend ? (
            <motion.button whileTap={{ scale: 0.9 }} onClick={onSend} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--accent)',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s', flexShrink: 0,
            }}>
              <ArrowUp size={16} strokeWidth={2} color="var(--accent-text)" />
            </motion.button>
          ) : (
            <motion.button
              onClick={toggleRecording}
              disabled={isProcessing}
              title={isRecording ? 'Нажми чтобы остановить' : 'Нажми для записи'}
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
          )}
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

function ThreadMenu({ onDelete, onRename }: { onDelete: () => void; onRename: () => void }) {
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
          minWidth: 140,
          overflow: 'hidden',
        }}>
          <button
            onClick={e => { e.stopPropagation(); onRename(); setOpen(false); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
              padding: '10px 16px', textAlign: 'left', cursor: 'pointer',
              fontFamily: M, fontSize: 14, color: 'var(--text-primary)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Pencil size={13} strokeWidth={1.75} />
            Переименовать
          </button>
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
  const { state: voiceStateTd, toggleRecording: toggleRecTd } = useVoiceInput(text => setChatInput(v => v ? v + ' ' + text : text));
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

  const total = todayTasks.length;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{ ...CC }}>

        {/* Date & day */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontFamily: F, fontSize: 13, color: '#aaa', marginBottom: 4 }}>
            {formatDateCard(now)}
          </div>
          <div style={{ fontFamily: F, fontSize: 34, color: '#111', lineHeight: 1 }}>
            {DAY_NAMES_RU[now.getDay()]}
          </div>
        </div>

        {/* Add task button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={onAddTask}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', color: '#aaa' }}
          >
            <Plus size={20} strokeWidth={1.75} />
          </button>
        </div>

        {/* Unified card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 20,
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}>

          {/* Task list */}
          {total > 0 && (
            <div>
              {todayTasks.map((task, idx) => (
                <div key={task.id} style={{ borderBottom: idx < todayTasks.length - 1 ? '1px solid #f5f5f5' : undefined }}>
                  <TaskRow
                    task={task}
                    onToggle={() => toggleTask(task.id)}
                    onToggleSubtask={subId => toggleSubtask(task.id, subId)}
                    onClick={() => onEditTask(task)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ borderTop: total > 0 ? '1px solid #f5f5f5' : undefined, padding: '13px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChat()}
                placeholder="Спроси у мысли..."
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 14, color: 'var(--text-primary)' }}
              />
              {chatInput.trim() ? (
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleChat} style={{
                  width: 32, height: 32, borderRadius: '50%', background: '#111',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <ArrowUp size={15} strokeWidth={2} color="#fff" />
                </motion.button>
              ) : (
                <button
                  onClick={toggleRecTd}
                  disabled={voiceStateTd === 'processing'}
                  title={voiceStateTd === 'recording' ? 'Нажми чтобы остановить' : 'Нажми для записи'}
                  style={{ background: voiceStateTd === 'recording' ? '#c0392b' : 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', flexShrink: 0, transition: 'background 0.15s' }}>
                  <Mic size={17} strokeWidth={1.5} color={voiceStateTd === 'recording' ? '#fff' : '#bbb'} />
                </button>
              )}
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
  threadId, threads, setThreads, tasks, setTasks, initialMessage, onInitialConsumed, onNetworkError, onOpenThread, onOpenNote,
}: {
  key?: React.Key;
  threadId: string;
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  initialMessage?: string | null;
  onInitialConsumed?: () => void;
  onNetworkError?: () => void;
  onOpenThread?: (id: string) => void;
  onOpenNote?: (id: string) => void;
}) {
  const THINKING_PHRASES = ['Думаю...', 'Анализирую...', 'Ищу в архиве...', 'Формулирую...', 'Пишу ответ...'];

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const [animatingContent, setAnimatingContent] = useState<string | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [openMsgMenuIdx, setOpenMsgMenuIdx] = useState<number | null>(null);
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const [openSourcesIdx, setOpenSourcesIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoSend = useRef(false);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIsTypingRef = useRef(false);

  const thread = threads.find(t => t.id === threadId);
  const threadRef = useRef(thread);
  threadRef.current = thread;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread?.messages, isTyping]);

  // Summarize on unmount if thread has enough content and no summary
  useEffect(() => {
    return () => {
      const t = threadRef.current;
      if (!t || t.summary) return;
      const userMsgs = t.messages.filter((m: any) => m.role === 'user');
      if (userMsgs.length < 2) return;
      apiFetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: t.messages, threadId: t.id }),
      }).then(r => r.json()).then(({ summary }) => {
        if (summary) {
          setThreads((prev: Thread[]) => prev.map(p =>
            p.id === t.id ? { ...p, summary, is_meaningful: true } : p
          ));
        }
      }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (initialMessage && !didAutoSend.current) {
      didAutoSend.current = true;
      onInitialConsumed?.();
      sendMessage(initialMessage);
    }
  }, []);

  useEffect(() => {
    if (!isTyping) return;
    const iv = setInterval(() => setThinkingIdx(p => (p + 1) % THINKING_PHRASES.length), 1800);
    return () => clearInterval(iv);
  }, [isTyping]);

  useEffect(() => {
    if (prevIsTypingRef.current && !isTyping) {
      const visibleMsgs = (thread?.messages || []).filter(m => m.role !== 'tool' && !m.tool_calls);
      const last = visibleMsgs[visibleMsgs.length - 1];
      if (last?.role === 'assistant' && last.content) {
        const fullText = last.content;
        let i = 0;
        setAnimatingContent('');
        if (animIntervalRef.current) clearInterval(animIntervalRef.current);
        animIntervalRef.current = setInterval(() => {
          i += 6;
          if (i >= fullText.length) {
            clearInterval(animIntervalRef.current!);
            setAnimatingContent(null);
          } else {
            setAnimatingContent(fullText.slice(0, i));
          }
        }, 10);
      }
    }
    prevIsTypingRef.current = isTyping;
  }, [isTyping]);

  if (!thread) return null;

  const generateTitle = async (userText: string, assistantText: string) => {
    try {
      const resp = await generateResponse(
        [{ role: 'user', content: `Придумай короткое название (3-5 слов, без кавычек) для чата, где пользователь написал:\n«${userText}»\nИИ ответил:\n«${assistantText.slice(0, 200)}»\nТолько название, без пояснений`, time: '' }],
        { no_tools: true }
      );
      const title = resp?.content?.trim().replace(/^["«]|["»]$/g, '').slice(0, 60);
      if (!title) return;
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
        if (t.id !== threadId) return t;
        const u = { ...t, title };
        db.saveThread(u);
        return u;
      }));
    } catch { /* не критично */ }
  };

  const saveMessageAsNote = (content: string) => {
    const noteId = uuid();
    const note: Thread = {
      id: noteId,
      title: content.trim().slice(0, 40) || 'Заметка',
      preview: content.trim().slice(0, 100),
      messages: [],
      createdAt: Date.now(),
      source: 'заметка' as const,
      is_meaningful: true,
      summary: content.trim(),
    };
    db.saveThread(note);
    setThreads((prev: Thread[]) => [note, ...(Array.isArray(prev) ? prev : [])]);
    apiFetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: content.trim() }], threadId: noteId }),
    }).catch(() => {});
  };

  const deleteMessage = (msg: Message) => {
    setThreads((prev: Thread[]) => prev.map(t => {
      if (t.id !== threadId) return t;
      const newMessages = t.messages.filter(m => m !== msg);
      const updated = { ...t, messages: newMessages };
      db.saveThread(updated);
      return updated;
    }));
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isTyping) return;
    const finalText = replyQuote
      ? `[Ответ на: "${replyQuote.length > 100 ? replyQuote.slice(0, 100) + '...' : replyQuote}"]\n${text}`
      : text;
    setInput('');
    setReplyQuote(null);
    sendMessage(finalText);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setInput('');

    const userMsg = { role: 'user' as const, content: text, time: nowTime() };
    const isFirstMessage = thread.messages.length === 0;
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
        const assistantMsg = { role: 'assistant' as const, content: response.content || '', tool_calls: response.tool_calls, reasoning_content: response.reasoning_content, time: nowTime() };
        turnMsgs.push(assistantMsg);

        for (const call of response.tool_calls) {
          const { name } = call.function;
          const args = JSON.parse(call.function.arguments);
          let result: any;

          if (name === 'get_tasks') {
            const filtered = args.date ? tasks.filter(t => t.date === args.date) : tasks;
            result = filtered.length > 0 ? filtered : 'Задач не найдено.';
          } else if (name === 'add_task') {
            const newTask: Task = {
              id: uuid(), name: args.name, time: args.time || '', endTime: args.endTime || undefined,
              date: args.date || todayStr(), done: false, threadId,
              category: args.category || 'none',
              // Время предложено агентом → 'agent' (можно пересчитывать). Без времени — не ставим.
              timeSource: args.time ? 'agent' : undefined,
              // Гибкая задача без жёсткого времени — рекомендованный агентом слот.
              suggestedTime: args.suggestedTime || undefined,
              suggestedEndTime: args.suggestedEndTime || undefined,
            };
            setTasks(prev => [...(Array.isArray(prev) ? prev : []), newTask]);
            db.saveTask(newTask);
            result = { status: 'success', task: newTask };
          } else if (name === 'update_task') {
            setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
              if (t.id === args.id) {
                const timeChanged = args.time !== undefined && args.time !== t.time;
                const u: Task = {
                  ...t,
                  done: args.done ?? t.done,
                  name: args.name || t.name,
                  time: args.time ?? t.time,
                  endTime: args.endTime ?? t.endTime,
                  date: args.date ?? t.date,
                  category: args.category ?? t.category,
                  // Агент сдвинул время → источник остаётся 'agent' (его предложение).
                  timeSource: timeChanged ? 'agent' : t.timeSource,
                };
                db.saveTask(u);
                return u;
              }
              return t;
            }));
            result = { status: 'success' };
          } else if (name === 'delete_task') {
            setTasks(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== args.id));
            db.deleteTask(args.id);
            result = { status: 'success' };
          } else if (name === 'save_as_note') {
            const { content, title } = args;
            const noteId = uuid();
            const savedNote: Thread = {
              id: noteId,
              title: (title || content.trim().slice(0, 40)) || 'Заметка',
              preview: content.trim().slice(0, 100),
              messages: [],
              createdAt: Date.now(),
              source: 'заметка' as const,
              is_meaningful: true,
              summary: content.trim(),
            };
            db.saveThread(savedNote);
            setThreads(prev => [savedNote, ...(Array.isArray(prev) ? prev : [])]);
            apiFetch('/api/summarize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages: [{ role: 'user', content: content.trim() }], threadId: noteId }),
            }).catch(() => {});
            result = { status: 'success', noteId };
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

      const finalMsg = { role: 'assistant' as const, content: response.content || 'Готово!', reasoning_content: response.reasoning_content, time: nowTime(), sources: response.sources };
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
      if (isFirstMessage) generateTitle(text, finalMsg.content);
    } catch (err: any) {
      const isNetworkErr = !err.message || err.message === 'fetch failed' || err.message.includes('Failed to fetch') || err.message.includes('Ошибка сети');
      if (isNetworkErr) { onNetworkError?.(); return; }
      const errMsg = { role: 'assistant' as const, content: `Ошибка: ${err.message}`, time: nowTime() };
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
        const allAnswered = msg.planning_data.questions.every((q: any) => msg.planning_data?.answers?.[q.id] !== undefined);
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
      const response = await generateResponse([...t.messages, { role: 'user', content: prompt, time: nowTime() }], { no_tools: true });
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
          {(openMsgMenuIdx !== null || openSourcesIdx !== null) && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => { setOpenMsgMenuIdx(null); setOpenSourcesIdx(null); }} />
          )}

          {visible.map((m, i) => {
            const realIdx = thread.messages.indexOf(m);
            const isLast = i === visible.length - 1;
            const showAnimated = isLast && m.role === 'assistant' && animatingContent !== null;
            const showActions = hoveredMsgIdx === i || openMsgMenuIdx === i || openSourcesIdx === i;
            return (
              <div key={i}
                onMouseEnter={() => m.role === 'assistant' && setHoveredMsgIdx(i)}
                onMouseLeave={() => setHoveredMsgIdx(null)}
                style={{
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
                    {showAnimated
                      ? <span style={{ fontFamily: M, fontSize: 15, color: 'var(--text-80)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{animatingContent}</span>
                      : <MarkdownText text={m.content} style={{ fontFamily: M, fontSize: 15, color: 'var(--text-80)', lineHeight: 1.75 }} />
                    }

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

                {/* Action panel — assistant messages only */}
                {m.role === 'assistant' && !showAnimated && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', marginTop: 2,
                    opacity: showActions ? 1 : 0,
                    transition: 'opacity 0.15s',
                    position: 'relative',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button
                        onClick={() => navigator.clipboard?.writeText(m.content)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#bbb', display: 'flex', alignItems: 'center', transition: 'color 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#555')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
                      >
                        <Copy size={14} strokeWidth={1.5} />
                      </button>

                      {m.sources && m.sources.length > 0 && (
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={() => setOpenSourcesIdx(openSourcesIdx === i ? null : i)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              background: openSourcesIdx === i ? 'rgba(0,0,0,0.06)' : 'none',
                              border: 'none', cursor: 'pointer', padding: '2px 8px', borderRadius: 20,
                              fontFamily: M, fontSize: 12, color: openSourcesIdx === i ? '#333' : '#bbb',
                              transition: 'color 0.12s, background 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#555'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = openSourcesIdx === i ? '#333' : '#bbb'; }}
                          >
                            <BookOpen size={13} strokeWidth={1.5} />
                            Источники
                          </button>

                          <AnimatePresence>
                            {openSourcesIdx === i && (
                              <motion.div
                                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                transition={{ duration: 0.14 }}
                                style={{
                                  position: 'absolute', left: 0, bottom: '100%', marginBottom: 6,
                                  background: '#fff', border: '1px solid #ebebeb',
                                  borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                                  padding: '6px 0', zIndex: 30, minWidth: 240,
                                }}
                              >
                                <div style={{ padding: '4px 14px 8px', fontFamily: M, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: 'var(--text-30)' }}>
                                  Из архива · {m.sources.length}
                                </div>
                                {m.sources.map((s: { title: string; snippet?: string }, si: number) => {
                                  return (
                                    <div
                                      key={si}
                                      style={{
                                        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                                        padding: '8px 14px', textAlign: 'left',
                                        borderTop: si > 0 ? '1px solid #f0f0f0' : undefined,
                                      }}
                                    >
                                      <div style={{
                                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                                        background: 'rgba(0,0,0,0.06)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontFamily: M, fontSize: 10, fontWeight: 600, color: 'var(--text-30)',
                                      }}>
                                        {si + 1}
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {s.title}
                                        </div>
                                        {s.snippet && (
                                          <div style={{ fontFamily: M, fontSize: 11, color: 'var(--text-30)', marginTop: 2, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {s.snippet}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenMsgMenuIdx(openMsgMenuIdx === i ? null : i)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#bbb', display: 'flex', alignItems: 'center', transition: 'color 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#555')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
                      >
                        <MoreHorizontal size={14} strokeWidth={1.5} />
                      </button>

                      <AnimatePresence>
                        {openMsgMenuIdx === i && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            transition={{ duration: 0.12 }}
                            style={{
                              position: 'absolute', right: 0, bottom: '100%', marginBottom: 4,
                              background: '#fff', border: '1px solid #ebebeb',
                              borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                              padding: '4px 0', zIndex: 20, minWidth: 160,
                            }}
                          >
                            {[
                              { label: 'Сохранить как заметку', color: '#222', action: () => { saveMessageAsNote(m.content); setOpenMsgMenuIdx(null); } },
                              { label: 'Ответить', color: '#222', action: () => { setReplyQuote(m.content); setOpenMsgMenuIdx(null); } },
                              { label: 'Удалить', color: '#e53e3e', action: () => { deleteMessage(m); setOpenMsgMenuIdx(null); } },
                            ].map(item => (
                              <button key={item.label}
                                onClick={item.action}
                                style={{
                                  display: 'block', width: '100%', textAlign: 'left',
                                  padding: '8px 14px', fontSize: 13, color: item.color,
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontFamily: M, transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                              >
                                {item.label}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {isTyping && (
            <div style={{ alignSelf: 'flex-start', paddingLeft: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
              <MysliThinking />
              <span style={{ fontFamily: M, fontSize: 14, color: 'var(--text-30)', fontStyle: 'italic' }}>
                {THINKING_PHRASES[thinkingIdx]}
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '0 0 32px', flexShrink: 0 }}>
        <div style={{ ...CC }}>
          <AnimatePresence>
            {replyQuote && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.12 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#f5f5f5', borderRadius: 6, padding: '8px 12px',
                  marginBottom: 6, borderLeft: '2px solid #aaa',
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: '#888', fontFamily: M, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {replyQuote.length > 100 ? replyQuote.slice(0, 100) + '...' : replyQuote}
                </span>
                <button onClick={() => setReplyQuote(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <X size={14} strokeWidth={1.5} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <ChatInputBar value={input} onChange={setInput} onSend={handleSend} disabled={isTyping} placeholder="Задай уточняющий вопрос" />
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
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchResults, setSearchResults] = useState<Thread[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingId]);

  const handleNoteSaved = (saved: Thread) => {
    setThreads((prev: Thread[]) => {
      const exists = (Array.isArray(prev) ? prev : []).some(t => t.id === saved.id);
      return exists ? prev.map(t => t.id === saved.id ? saved : t) : [saved, ...(Array.isArray(prev) ? prev : [])];
    });
    setShowNoteEditor(false);
    setEditingNoteId(null);
  };

  const openNoteEditor = (noteId?: string) => {
    setEditingNoteId(noteId || null);
    setShowNoteEditor(true);
  };

  const handleRename = async (id: string) => {
    const val = renameValue.trim();
    if (!val) { setRenamingId(null); return; }
    setThreads((prev: Thread[]) => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== id) return t;
      const u = { ...t, title: val };
      db.saveThread(u);
      return u;
    }));
    setRenamingId(null);
  };

  const all = Array.isArray(threads) ? threads : [];

  const isNoteThread = (t: Thread) =>
    t.source !== 'skill' && (t.source === 'заметка' || (Boolean(t.summary?.trim()) && t.is_meaningful !== false));

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const user = getCurrentUser();
        if (!user) return;
        const res = await apiFetch(`/api/search?q=${encodeURIComponent(search)}`);
        if (!res.ok) return;
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch { setSearchResults(null); }
    }, 400);
  }, [search]);

  const searchMatch = (t: Thread) =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.preview.toLowerCase().includes(search.toLowerCase());

  const sortByUpdated = (arr: Thread[]) => [...arr].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  const thoughts = sortByUpdated(all.filter(t => t.source !== 'skill' && t.source !== 'заметка' && searchMatch(t)));
  const notes = sortByUpdated(all.filter(t => isNoteThread(t) && searchMatch(t)));

  const searchFiltered = searchResults
    ? searchResults.filter(t => tab === 'thoughts' ? t.source !== 'заметка' : isNoteThread(t))
    : null;

  const displayed = search.trim()
    ? (searchFiltered ?? (tab === 'thoughts' ? thoughts : notes))
    : (tab === 'thoughts' ? thoughts : notes);

  const deleteThread = async (id: string) => {
    setThreads((prev: Thread[]) => (Array.isArray(prev) ? prev : []).filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  const handleRowClick = (th: Thread) => {
    if (tab === 'notes') {
      if (th.source === 'заметка') openNoteEditor(th.id);
      else onOpenNote(th.id);
    } else {
      onOpenThread(th.id);
    }
  };

  const editingNote = editingNoteId ? threads.find(t => t.id === editingNoteId) : undefined;

  if (showNoteEditor) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <NoteEditor
          thread={editingNote}
          onSaved={handleNoteSaved}
          onClose={() => { setShowNoteEditor(false); setEditingNoteId(null); }}
        />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ ...CC, paddingTop: 40, paddingBottom: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ position: 'relative', display: 'flex', background: 'rgba(0,0,0,0.05)', borderRadius: 40, padding: 3, gap: 0 }}>
            <motion.div
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              style={{
                position: 'absolute', top: 3, bottom: 3,
                width: tab === 'thoughts' ? '50%' : '50%',
                left: tab === 'thoughts' ? 3 : 'calc(50%)',
                background: 'var(--surface)',
                borderRadius: 40,
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                zIndex: 0,
              }}
              animate={{ left: tab === 'thoughts' ? 3 : 'calc(50%)' }}
            />
            {([['thoughts', 'Твои мысли'], ['notes', 'Заметки']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                fontFamily: M, fontSize: 12, fontWeight: 500, letterSpacing: '0.02em',
                padding: '6px 16px', borderRadius: 40, border: 'none', cursor: 'pointer',
                background: 'transparent',
                color: 'var(--text)',
                opacity: tab === key ? 1 : 0.45,
                transition: 'opacity 0.2s',
                position: 'relative', zIndex: 1,
                whiteSpace: 'nowrap' as const,
              }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ width: 120, display: 'flex', justifyContent: 'flex-end' }}>
            {tab === 'notes' ? (
              <button onClick={() => openNoteEditor()} style={{
                fontFamily: M, fontSize: 12, letterSpacing: '0.04em',
                color: 'var(--text-primary)', background: 'none', border: 'none',
                cursor: 'pointer', textTransform: 'uppercase' as const, padding: 0,
                display: 'flex', alignItems: 'center', gap: 5, opacity: 0.6,
              }}>
                <Plus size={13} strokeWidth={1.75} />
                Заметка
              </button>
            ) : (
              <button onClick={startNewThread} style={{
                fontFamily: M, fontSize: 12, letterSpacing: '0.04em',
                color: 'var(--text-primary)', background: 'none', border: 'none',
                cursor: 'pointer', textTransform: 'uppercase' as const, padding: 0, opacity: 0.6,
              }}>
                + Мысль
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.04)', borderRadius: 40, padding: '10px 16px', marginBottom: 8 }}>
          <Search size={15} strokeWidth={1.75} color="var(--text-30)" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'thoughts' ? 'Поиск по архиву мыслей' : 'Поиск по заметкам'}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 14, color: 'var(--text-primary)' }} />
        </div>

        {/* List / Grid */}
        {displayed.length === 0 ? (
          <div style={{ padding: '40px 0', fontFamily: M, fontSize: 14, color: 'var(--text-30)', textAlign: 'center' }}>
            {search ? 'Ничего не найдено' : tab === 'thoughts' ? 'Мыслей пока нет' : 'Заметок пока нет. Нажми «+ Новая заметка»'}
          </div>
        ) : tab === 'notes' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingTop: 8 }}>
            {displayed.map(th => {
              const dateStr = new Date(th.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
              return (
                <div
                  key={th.id}
                  onClick={() => handleRowClick(th)}
                  style={{
                    background: 'var(--surface)', borderRadius: 16, padding: '14px 14px 12px',
                    cursor: 'pointer', minHeight: 100, display: 'flex', flexDirection: 'column', gap: 6,
                    border: '1px solid var(--border)', transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                >
                  {renamingId === th.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(th.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(th.id); if (e.key === 'Escape') setRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{ fontFamily: M, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', borderBottom: '1px solid rgba(0,0,0,0.2)', width: '100%' }}
                    />
                  ) : (
                    <div style={{
                      fontFamily: M, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {th.title}
                    </div>
                  )}
                  {th.preview && (
                    <div style={{
                      fontFamily: M, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, flex: 1,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {th.preview}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                    <span style={{ fontFamily: M, fontSize: 11, color: 'var(--text-30)' }}>{dateStr}</span>
                    <ThreadMenu
                      onRename={() => { setRenameValue(th.title); setRenamingId(th.id); }}
                      onDelete={() => deleteThread(th.id)}
                    />
                  </div>
                </div>
              );
            })}
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
                  {renamingId === th.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(th.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(th.id); if (e.key === 'Escape') setRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none', borderBottom: '1px solid rgba(0,0,0,0.2)', flex: 1 }}
                    />
                  ) : (
                    <div style={{
                      fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                    }}>
                      {th.title}
                    </div>
                  )}
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
              <ThreadMenu
                onRename={() => { setRenameValue(th.title); setRenamingId(th.id); }}
                onDelete={() => deleteThread(th.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Calendar task row (with animated checkbox) ────────────────────────────────

function CalendarTaskRow({ task, onToggle, onToggleSubtask, onClick }: {
  task: Task;
  onToggle: () => void;
  onToggleSubtask?: (subId: string) => void;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSubs = Boolean(task.subtasks?.length);
  return (
    <div>
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', cursor: 'pointer' }}>
        <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${task.done ? 'var(--text-primary)' : 'rgba(0,0,0,0.2)'}`,
          background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'border-color 0.15s',
          position: 'relative', overflow: 'hidden',
        }}>
          {task.done && (
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={12} color="#fff" strokeWidth={2.5} />
            </div>
          )}
        </button>
        <span style={{ fontFamily: M, fontSize: 15, flex: 1, color: task.done ? 'var(--text-30)' : 'var(--text-primary)', textDecoration: task.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.name}
        </span>
        {task.time && <span style={{ fontFamily: M, fontSize: 14, color: 'var(--text-30)', flexShrink: 0 }}>{task.time}</span>}
        {hasSubs && (
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--text-30)', flexShrink: 0 }}>
            <ChevronDown size={14} strokeWidth={1.75} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
          </button>
        )}
      </div>
      {hasSubs && expanded && (
        <div style={{ paddingLeft: 42, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {task.subtasks!.map(sub => (
            <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => onToggleSubtask?.(sub.id)} style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${sub.done ? 'var(--text-primary)' : 'var(--text-30)'}`, background: sub.done ? 'var(--text-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                {sub.done && <Check size={8} color="#fff" strokeWidth={2.5} />}
              </button>
              <span style={{ fontFamily: M, fontSize: 13, color: sub.done ? 'var(--text-30)' : 'var(--text-muted)', textDecoration: sub.done ? 'line-through' : 'none' }}>{sub.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calendar view ─────────────────────────────────────────────────────────────

function CalendarView({ tasks, setTasks, onEditTask, onQuickChat }: {
  tasks: Task[];
  setTasks: (t: Task[] | ((p: Task[]) => Task[])) => void;
  onEditTask: (t: Task) => void;
  onQuickChat: (msg: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const [view, setView] = useState<'list' | 'timeline'>(() => localStorage.getItem('mx_dash_view') === 'timeline' ? 'timeline' : 'list');
  const [createAt, setCreateAt] = useState<string | null>(null);
  const [miniCalOpen, setMiniCalOpen] = useState(false);

  const toggleView = () => setView(prev => {
    const next = prev === 'list' ? 'timeline' : 'list';
    localStorage.setItem('mx_dash_view', next);
    return next;
  });
  const [miniCalMonth, setMiniCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [addInput, setAddInput] = useState('');
  const [addFocused, setAddFocused] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const { state: voiceStateCal, toggleRecording: toggleRecCal } = useVoiceInput(text => setChatInput(v => v ? v + ' ' + text : text));
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const miniCalRef = useRef<HTMLDivElement>(null);
  const swipeDragStart = useRef<number | null>(null);
  const today = todayStr();

  const weekDays = useMemo(() => {
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dow + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
    });
  }, [weekOffset]);

  const filteredTasks = useMemo(() =>
    (Array.isArray(tasks) ? tasks : [])
      .filter(t => (t.date || today) === selectedDate)
      .sort((a, b) => { if (!a.time && !b.time) return 0; if (!a.time) return 1; if (!b.time) return -1; return a.time.localeCompare(b.time); }),
    [tasks, selectedDate, today]
  );

  const miniCalDays = useMemo(() => {
    const { year, month } = miniCalMonth;
    const startDow = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [miniCalMonth]);

  useEffect(() => {
    if (!miniCalOpen) return;
    const h = (e: MouseEvent) => { if (miniCalRef.current && !miniCalRef.current.contains(e.target as Node)) setMiniCalOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [miniCalOpen]);

  const goWeek = (dir: 1 | -1) => { setSlideDir(dir); setWeekOffset(v => v + dir); };

  const jumpToDate = (ds: string) => {
    const target = new Date(ds);
    const now = new Date();
    const baseMon = new Date(now); baseMon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const diff = Math.floor((target.getTime() - baseMon.getTime()) / 86400000);
    const newOffset = Math.floor(diff / 7);
    setSlideDir(newOffset >= weekOffset ? 1 : -1);
    setWeekOffset(newOffset);
    setSelectedDate(ds);
    setMiniCalOpen(false);
  };

  const toggleTask = (id: string) => setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => { if (t.id === id) { const u = { ...t, done: !t.done }; db.saveTask(u); return u; } return t; }));
  const toggleSubtask = (taskId: string, subId: string) => setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => { if (t.id !== taskId) return t; const u = { ...t, subtasks: t.subtasks?.map(s => s.id === subId ? { ...s, done: !s.done } : s) }; db.saveTask(u); return u; }));

  const handleAddTask = async () => {
    if (!addInput.trim()) return;
    const t: Task = { id: uuid(), name: addInput.trim(), time: '', date: selectedDate, done: false, category: 'none' };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setAddInput('');
  };

  // Создание задачи тапом по таймлайну: человек явно указал время → timeSource: 'user'.
  const createTimedTask = async (name: string, time: string, endTime: string) => {
    if (!name.trim()) return;
    const t: Task = {
      id: uuid(), name: name.trim(), time, endTime, date: selectedDate,
      done: false, category: 'none', timeSource: 'user',
    };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setCreateAt(null);
  };

  // Перетаскивание блока по таймлайну → timeSource: 'user'.
  const moveTask = (taskId: string, time: string, endTime: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
      if (t.id !== taskId) return t;
      const u: Task = { ...t, time, endTime, timeSource: 'user' };
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

          {/* Header: month title (left) + arrows capsule (right) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div ref={miniCalRef} style={{ position: 'relative' }}>
              <button
                onClick={() => { const d = new Date(selectedDate); setMiniCalMonth({ year: d.getFullYear(), month: d.getMonth() }); setMiniCalOpen(v => !v); }}
                onMouseEnter={() => { tooltipTimer.current = setTimeout(() => setTooltipVisible(true), 800); }}
                onMouseLeave={() => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); setTooltipVisible(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
              >
                <div style={{ fontFamily: M, fontSize: 16, color: 'var(--text-30)', lineHeight: 1.4, textAlign: 'center' }}>{year}</div>
                <div style={{ fontFamily: F, fontSize: 30, color: 'var(--text-80)', lineHeight: 1.1 }}>{month}</div>
              </button>

              {tooltipVisible && !miniCalOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'rgba(0,0,0,0.72)', color: '#fff', fontFamily: M, fontSize: 12, borderRadius: 6, padding: '4px 10px', whiteSpace: 'nowrap', zIndex: 100, pointerEvents: 'none' }}>
                  Выбрать дату
                </div>
              )}

              <AnimatePresence>
                {miniCalOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.15 }}
                    style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 200, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 16, width: 248 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <button onClick={() => setMiniCalMonth(v => { const d = new Date(v.year, v.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-40)', padding: '0 4px' }}>‹</button>
                      <span style={{ fontFamily: M, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{MONTH_SHORT[miniCalMonth.month]} {miniCalMonth.year}</span>
                      <button onClick={() => setMiniCalMonth(v => { const d = new Date(v.year, v.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-40)', padding: '0 4px' }}>›</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
                      {['пн','вт','ср','чт','пт','сб','вс'].map(d => <div key={d} style={{ textAlign: 'center', fontFamily: M, fontSize: 11, color: 'var(--text-30)', padding: '2px 0' }}>{d}</div>)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                      {miniCalDays.map((day, idx) => {
                        if (!day) return <div key={idx} />;
                        const ds = `${miniCalMonth.year}-${String(miniCalMonth.month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                        const isSel = ds === selectedDate;
                        const isTod = ds === today;
                        const isWknd = idx % 7 >= 5;
                        return (
                          <button key={idx} onClick={() => jumpToDate(ds)} style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', background: isSel ? 'var(--text-primary)' : 'transparent', border: isTod && !isSel ? '1px solid var(--text-30)' : 'none', cursor: 'pointer', fontFamily: M, fontSize: 12, color: isSel ? '#fff' : isWknd ? 'var(--text-30)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right-side controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AnimatePresence>
                {(selectedDate !== today || weekOffset !== 0) && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => { setWeekOffset(0); setSelectedDate(today); setSlideDir(1); }}
                    style={{ background: 'none', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 40, cursor: 'pointer', fontFamily: M, fontSize: 13, color: 'var(--text-40)', padding: '6px 14px', lineHeight: 1 }}
                  >
                    Сегодня
                  </motion.button>
                )}
              </AnimatePresence>
              {/* View toggle: список ⇄ таймлайн */}
              <button
                onClick={toggleView}
                title={view === 'list' ? 'Календарь по времени' : 'Список'}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 40, cursor: 'pointer', color: 'var(--text-40)', padding: '7px 12px', lineHeight: 1 }}
              >
                {view === 'list'
                  ? <CalendarRange size={17} strokeWidth={1.75} />
                  : <LayoutList size={17} strokeWidth={1.75} />}
              </button>
              {/* Arrows capsule */}
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 40, overflow: 'hidden' }}>
                <button onClick={() => goWeek(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: M, fontSize: 22, color: 'var(--text-40)', padding: '6px 14px', lineHeight: 1 }}>‹</button>
                <div style={{ width: 1, height: 20, background: 'rgba(0,0,0,0.1)' }} />
                <button onClick={() => goWeek(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: M, fontSize: 22, color: 'var(--text-40)', padding: '6px 14px', lineHeight: 1 }}>›</button>
              </div>
            </div>
          </div>

          {/* Day strip with slide animation */}
          <div style={{ height: 1, background: 'var(--border)' }} />
          <div
            style={{ overflow: 'hidden', position: 'relative', touchAction: 'pan-y' }}
            onTouchStart={e => { swipeDragStart.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (swipeDragStart.current === null) return;
              const dx = e.changedTouches[0].clientX - swipeDragStart.current;
              swipeDragStart.current = null;
              if (Math.abs(dx) < 40) return;
              goWeek(dx < 0 ? 1 : -1);
            }}
            onTouchCancel={() => { swipeDragStart.current = null; }}
            onPointerDown={e => { if (e.pointerType !== 'touch') swipeDragStart.current = e.clientX; }}
            onPointerUp={e => {
              if (e.pointerType === 'touch' || swipeDragStart.current === null) return;
              const dx = e.clientX - swipeDragStart.current;
              swipeDragStart.current = null;
              if (Math.abs(dx) < 40) return;
              goWeek(dx < 0 ? 1 : -1);
            }}
            onPointerCancel={() => { swipeDragStart.current = null; }}
          >
            <AnimatePresence mode="popLayout" initial={false} custom={slideDir}>
              <motion.div
                key={weekOffset}
                custom={slideDir}
                variants={{
                  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%' }),
                  center: { x: '0%' },
                  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%' }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.7 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', paddingTop: 4, paddingBottom: 4 }}>
                  {weekDays.map((d, i) => {
                    const ds = dateToStr(d);
                    const isSelected = ds === selectedDate;
                    const isToday = ds === today;
                    const isWeekend = i >= 5;
                    return (
                      <button key={ds} onClick={() => setSelectedDate(ds)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 4px', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                        <span style={{ fontFamily: M, fontSize: 16, fontWeight: 500, color: isWeekend ? 'rgba(0,0,0,0.22)' : 'var(--text-30)', letterSpacing: '0.02em' }}>{WEEK_DAYS[i].toLowerCase()}</span>
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: isSelected ? '#0B0D10' : isToday ? 'rgba(11,13,16,0.3)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 18, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", fontWeight: isSelected || isToday ? 700 : 400, color: isSelected || isToday ? '#fff' : isWeekend ? 'rgba(0,0,0,0.28)' : '#999B9E' }}>
                            {d.getDate()}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
          <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

          {view === 'list' ? (
            <>
              {/* Add task inline field */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${addFocused ? 'rgba(0,0,0,0.3)' : 'var(--border)'}`, borderRadius: 40, padding: '12px 16px', marginBottom: 20, transition: 'border-color 0.15s', background: '#fff' }}>
                <Plus size={15} strokeWidth={1.75} color="var(--text-30)" />
                <input
                  value={addInput}
                  onChange={e => setAddInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                  onFocus={() => setAddFocused(true)}
                  onBlur={() => setAddFocused(false)}
                  placeholder="Добавить задачу"
                  style={{ flex: 1, border: 'none', outline: 'none', fontFamily: M, fontSize: 14, color: 'var(--text-primary)', background: 'transparent' }}
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
                      onClick={handleAddTask}
                      style={{ width: 32, height: 32, borderRadius: '50%', background: '#0B0D10', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                      <ArrowUp size={16} color="#fff" strokeWidth={2} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* Tasks with stagger animation on day change */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={selectedDate}>
                  {filteredTasks.length === 0 ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '32px 0', textAlign: 'center', fontFamily: M, fontSize: 14, color: 'var(--text-30)' }}>
                      Нет задач на этот день
                    </motion.div>
                  ) : filteredTasks.map((task, idx) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: idx * 0.04, ease: 'easeOut' }}
                      style={{ borderBottom: idx < filteredTasks.length - 1 ? '1px solid var(--border)' : undefined }}
                    >
                      <CalendarTaskRow
                        task={task}
                        onToggle={() => toggleTask(task.id)}
                        onToggleSubtask={subId => toggleSubtask(task.id, subId)}
                        onClick={() => onEditTask(task)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </>
          ) : (
            <div style={{ height: 'min(720px, calc(100vh - 320px))', minHeight: 420 }}>
              <DayTimeline
                date={selectedDate}
                tasks={filteredTasks}
                onTaskClick={onEditTask}
                onUntimedClick={onEditTask}
                onCreateAt={(time) => setCreateAt(time)}
                onTaskMove={moveTask}
              />
            </div>
          )}

        </div>
      </div>

      {/* Создание задачи тапом по таймлайну (десктоп) */}
      <AnimatePresence>
        {createAt && (
          <TimelineCreatePopover
            startTime={createAt}
            onCancel={() => setCreateAt(null)}
            onCreate={createTimedTask}
          />
        )}
      </AnimatePresence>

      {/* Quick chat — висячее поле внизу */}
      <div style={{ flexShrink: 0, padding: '12px 24px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 40, padding: '10px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && chatInput.trim()) { onQuickChat(chatInput.trim()); setChatInput(''); } }}
            placeholder="Спроси у мысли..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: M, fontSize: 14, color: 'var(--text-primary)' }}
          />
          <button
            onClick={toggleRecCal}
            disabled={voiceStateCal === 'processing'}
            title={voiceStateCal === 'recording' ? 'Нажми чтобы остановить' : 'Нажми для записи'}
            style={{ background: voiceStateCal === 'recording' ? '#c0392b' : 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', transition: 'background 0.15s' }}>
            <Mic size={17} strokeWidth={1.5} color={voiceStateCal === 'recording' ? '#fff' : '#bbb'} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  collapsed, onToggle, screen, setScreen, calActive, setCalActive, threads, startNewThread, newChatActive, onOpenThread, onDropText,
}: {
  collapsed: boolean;
  onToggle: () => void;
  screen: Screen;
  setScreen: (s: Screen) => void;
  calActive: boolean;
  setCalActive: (v: boolean) => void;
  threads: Thread[];
  startNewThread: () => void;
  newChatActive: boolean;
  onOpenThread: (id: string) => void;
  onDropText: (text: string) => void;
}) {

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
          padding: collapsed ? '7px' : '7px 12px 7px 8px',
          borderRadius: 40, border: 'none', cursor: 'pointer',
          background: active ? '#f0f0f0' : hovered ? '#f7f7f7' : 'transparent',
          color: active ? '#111' : '#888',
          fontWeight: active ? 500 : 400,
          transition: 'background 0.12s, color 0.12s, gap 0.28s cubic-bezier(0.4,0,0.2,1), padding 0.28s cubic-bezier(0.4,0,0.2,1)',
          minHeight: 36, flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <motion.span
          animate={{ opacity: collapsed ? 0 : 1, maxWidth: collapsed ? 0 : 200 }}
          transition={collapsed ? { duration: 0.1 } : { duration: 0.18, delay: 0.13 }}
          style={{ fontFamily: M, fontSize: 15, whiteSpace: 'nowrap', fontWeight: 'inherit', color: 'inherit', overflow: 'hidden', display: 'block' }}
        >
          {label}
        </motion.span>
      </button>
    );
  };

  const [dragOver, setDragOver] = useState(false);
  const [dropHovered, setDropHovered] = useState(false);

  const recentThreads = (Array.isArray(threads) ? threads : [])
    .filter(t => t.source !== 'skill' && t.source !== 'заметка')
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).slice(0, 8);

  return (
    <motion.div
      animate={{ width: collapsed ? 64 : 190 }}
      transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
      style={{
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', flexShrink: 0, height: '100%',
      }}
    >
      {/* Header: logo fades, toggle button always visible */}
      <div style={{ display: 'flex', alignItems: 'center', padding: collapsed ? '18px' : '18px 12px 18px 14px', flexShrink: 0 }}>
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 28 }}
          transition={collapsed ? { duration: 0.12 } : { duration: 0.2, delay: 0.14 }}
          style={{ overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center' }}
        >
          <LogoIcon size={28} />
        </motion.div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onToggle}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-30)', flexShrink: 0 }}
        >
          {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.5} /> : <PanelLeftClose size={18} strokeWidth={1.5} />}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <NavBtn icon={<Plus size={17} strokeWidth={1.75} />} label="Новый чат" active={newChatActive} onClick={startNewThread} />

        <NavBtn icon={<Sun size={17} strokeWidth={1.75} />} label="Сегодня" active={screen === 'dash' && !calActive} onClick={() => { setScreen('dash'); setCalActive(false); }} />
        <NavBtn icon={<MxIcon.CalendarIcon size={16} />} label="Календарь" active={screen === 'dash' && calActive} onClick={() => { setScreen('dash'); setCalActive(true); }} />
        <NavBtn icon={<MxIcon.ChatIcon size={16} />} label="Твои мысли" active={screen === 'threads' || (screen === 'ai' && !newChatActive)} onClick={() => setScreen('threads')} />
      </nav>

      {/* Chats section */}
      <AnimatePresence>
        {!collapsed && recentThreads.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, delay: 0.12 }}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 10 }}
          >
            <div style={{ padding: '4px 12px 4px 22px', flexShrink: 0 }}>
              <span style={{ fontFamily: M, fontSize: 12, fontWeight: 500, letterSpacing: '0.04em', color: 'var(--text-30)', textTransform: 'uppercase' }}>Чаты</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px' }}>
              {recentThreads.map(th => (
                <div key={th.id} onClick={() => onOpenThread(th.id)}
                  title={th.title}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f7')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)', padding: '5px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s' }}
                >
                  {th.title}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer when collapsed or no threads */}
      {(collapsed || recentThreads.length === 0) && <div style={{ flex: 1 }} />}

      {/* Drag & drop zone */}
      <div
        onMouseEnter={() => setDropHovered(true)}
        onMouseLeave={() => setDropHovered(false)}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
          if (text.trim()) onDropText(text.trim());
        }}
        style={{
          margin: '0 8px 10px', borderRadius: 10,
          border: `1.5px dashed ${dragOver ? 'var(--text-primary)' : dropHovered ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.12)'}`,
          background: dragOver ? 'rgba(0,0,0,0.04)' : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, minHeight: 72, cursor: 'default',
        }}
      >
        <span style={{ fontFamily: M, fontSize: 20, color: dragOver ? 'var(--text-primary)' : dropHovered ? 'var(--text-30)' : 'var(--text-ultra)', lineHeight: 1, transition: 'color 0.15s' }}>+</span>
        {!collapsed && (dropHovered || dragOver) && (
          <span style={{ fontFamily: M, fontSize: 11, color: dragOver ? 'var(--text-primary)' : 'var(--text-30)', textAlign: 'center', lineHeight: 1.4, padding: '0 6px' }}>
            {dragOver ? 'Отпусти — создастся заметка' : 'Перетащи сюда любой текст'}
          </span>
        )}
      </div>

      {/* Settings */}
      <div style={{ padding: '10px 8px 18px' }}>
        <NavBtn icon={<MxIcon.SettingsIcon size={16} />} label="Настройки" active={screen === 'settings'} onClick={() => setScreen('settings')} />
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
  useEffect(() => {
    // Онбординг ('ob') обрабатывается на уровне App.tsx и до DesktopApp не доходит.
    // Мобильный 'today' на десктопе схлопываем в дашборд.
    if (screen === 'today') setScreen('dash');
  }, [screen]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [noInternet, setNoInternet] = useState(false);

  const addTask = async (name: string, time: string, date: string) => {
    const t: Task = { id: uuid(), name, time, date, done: false };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setIsAddModalOpen(false);
  };

  const createTaskFromPanel = async (patch: TaskCreatePatch) => {
    const t: Task = {
      id: uuid(), name: patch.name, time: patch.time, endTime: patch.endTime || undefined,
      date: patch.date, done: false, description: patch.description, location: patch.location,
      category: patch.category,
      // Создание вручную с указанным временем → источник 'user'.
      timeSource: patch.time ? 'user' : undefined,
    };
    setTasks(prev => [...(Array.isArray(prev) ? prev : []), t]);
    await db.saveTask(t);
    setIsCreatingTask(false);
  };

  const updateTask = async (id: string, patch: TaskEditPatch) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => {
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
        timeSource: patch.timeChangedByUser ? 'user' : t.timeSource,
        // Появилось реальное время — предложение агента больше не нужно.
        suggestedTime: patch.time ? undefined : t.suggestedTime,
        suggestedEndTime: patch.time ? undefined : t.suggestedEndTime,
      };
      db.saveTask(u);
      return u;
    }));
  };

  const deleteTask = async (id: string) => {
    setTasks(prev => (Array.isArray(prev) ? prev : []).filter(t => t.id !== id));
    await db.deleteTask(id);
    setEditingTask(null);
  };

  const startNewThreadWithMessage = (message: string) => {
    const newTh: Thread = { id: uuid(), title: 'Новая мысль', preview: message.slice(0, 60), messages: [], createdAt: Date.now() };
    setThreads(prev => [...(Array.isArray(prev) ? prev : []), newTh]);
    setCurTh(newTh.id);
    setNoteMode(false);
    setPendingMessage(message);
    setScreen('ai');
    db.saveThread(newTh);
  };

  const handleStartNewThread = () => {
    setCurTh(null);
    setNoteMode(false);
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
    handleOpenThread(newTh.id);
    db.saveThread(newTh);
  };

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
        screen={screen}
        setScreen={setScreen}
        calActive={calActive}
        setCalActive={setCalActive}
        threads={threads}
        startNewThread={handleStartNewThread}
        newChatActive={screen === 'ai' && !curTh && !noteMode}
        onOpenThread={handleOpenThread}
        onDropText={handleDropText}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AnimatePresence mode="wait">

          {screen === 'dash' && !calActive && (
            <motion.div key="today" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.13 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <TodayScreen tasks={tasks} setTasks={setTasks} onQuickChat={startNewThreadWithMessage} onAddTask={() => { setEditingTask(null); setIsCreatingTask(true); }} onEditTask={(t) => { setIsCreatingTask(false); setEditingTask(t); }} />
            </motion.div>
          )}

          {screen === 'dash' && calActive && (
            <motion.div key="cal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.13 }} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <CalendarView tasks={tasks} setTasks={setTasks} onEditTask={setEditingTask} onQuickChat={startNewThreadWithMessage} />
            </motion.div>
          )}

          {screen === 'ai' && (
            <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.13 }} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Chat/Note toggle header */}
              {curTh && (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'rgba(9,14,23,0.06)', borderRadius: 40, padding: 3, position: 'relative' }}>
                    <motion.div
                      animate={{ left: noteMode ? 'calc(50%)' : 3 }}
                      style={{
                        position: 'absolute',
                        top: 3, left: noteMode ? 'calc(50%)' : 3,
                        width: 'calc(50% - 3px)', height: 28,
                        borderRadius: 32,
                        background: '#ffffff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
                        zIndex: 0,
                      }}
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    />
                    <button
                      onClick={() => setNoteMode(false)}
                      style={{ position: 'relative', zIndex: 1, padding: '5px 16px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 32, fontFamily: M, fontSize: 12, fontWeight: 500, color: !noteMode ? 'var(--text-primary)' : 'var(--text-30)', transition: 'color 0.15s', whiteSpace: 'nowrap' }}
                    >
                      Чат
                    </button>
                    <button
                      onClick={() => setNoteMode(true)}
                      style={{ position: 'relative', zIndex: 1, padding: '5px 16px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 32, fontFamily: M, fontSize: 12, fontWeight: 500, color: noteMode ? 'var(--text-primary)' : 'var(--text-30)', transition: 'color 0.15s', whiteSpace: 'nowrap' }}
                    >
                      Заметка
                    </button>
                  </div>
                </div>
              )}

              {curTh && noteMode ? (
                <NoteView
                  threadId={curTh}
                  threads={threads}
                  setThreads={setThreads}
                  tasks={tasks}
                  onSwitchToChat={() => setNoteMode(false)}
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
                  onNetworkError={() => setNoInternet(true)}
                  onOpenThread={handleOpenThread}
                  onOpenNote={handleOpenNote}
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
              <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen('dash')} onLogout={handleLogout} isDesktop />
            </motion.div>
          )}

        </AnimatePresence>
        </div>

        <TaskDetailPanel
          task={editingTask}
          isCreating={isCreatingTask}
          initialDate={todayStr()}
          onClose={() => { setEditingTask(null); setIsCreatingTask(false); }}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onCreate={createTaskFromPanel}
          onOpenThread={id => { setCurTh(id); setScreen('ai'); }}
        />
      </div>

      <AddTaskModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onAdd={addTask} initialDate={todayStr()} />

      <AnimatePresence>
        {noInternet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}
          >
            <LogoIcon size={40} />
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <div style={{ fontFamily: M, fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
                С интернетом что-то не то...
              </div>
              <div style={{ fontFamily: M, fontSize: 15, color: 'var(--text-30)', lineHeight: 1.5 }}>
                Попробуй немного подождать и обновить страницу
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 8, padding: '11px 28px', background: '#0B0D10', color: '#fff', border: 'none', borderRadius: 40, fontFamily: M, fontSize: 15, fontWeight: 500, cursor: 'pointer' }}
            >
              Обновить
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
