import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { MessageCircle, Check } from 'lucide-react';
import { Thread, Task } from '../types';
import { db } from '../lib/db';
import { getCurrentUser, apiFetch } from '../lib/auth';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

function renderMarkdown(text: string): React.ReactNode[] {
  const paragraphs = text.split(/\n\n+/);
  return paragraphs.map((para, pi) => {
    const lines = para.split('\n');
    const isList = lines.every(l => /^[-–—•]\s/.test(l.trim()) || l.trim() === '');
    if (isList) {
      return (
        <ul key={pi} style={{ margin: '0 0 12px', paddingLeft: 16, listStyle: 'none' }}>
          {lines.filter(l => l.trim()).map((line, li) => (
            <li key={li} style={{ marginBottom: 4, display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--text-30)', flexShrink: 0 }}>–</span>
              <span>{renderInline(line.replace(/^[-–—•]\s*/, ''))}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p key={pi} style={{ margin: '0 0 12px', lineHeight: 1.75 }}>
        {lines.map((line, li) => (
          <React.Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(line)}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

const CC: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  margin: '0 auto',
  padding: '0 24px',
};

function SkeletonLine({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div style={{
      width, height, borderRadius: 6,
      background: 'linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.06) 75%)',
      backgroundSize: '200% 100%',
      animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
    }} />
  );
}

interface NoteViewProps {
  threadId: string;
  threads: Thread[];
  setThreads: (t: Thread[] | ((p: Thread[]) => Thread[])) => void;
  tasks: Task[];
  onSwitchToChat: () => void;
}

export default function NoteView({ threadId, threads, setThreads, tasks, onSwitchToChat }: NoteViewProps) {
  const thread = threads.find(t => t.id === threadId);
  const [loading, setLoading] = useState(false);
  const [summaryReady, setSummaryReady] = useState(Boolean(thread?.summary));

  useEffect(() => {
    if (!thread) return;
    if (thread.summary) { setSummaryReady(true); return; }

    // Only skip if explicitly marked not meaningful
    if (thread.is_meaningful === false) { setSummaryReady(true); return; }

    const userMessages = thread.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    if (userMessages.length === 0) { setSummaryReady(true); return; }

    const userId = getCurrentUser()?.id;
    setLoading(true);
    apiFetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: thread.messages, threadId, userId }),
    })
      .then(r => r.json())
      .then(({ summary, is_meaningful }) => {
        const updated = { ...thread, summary: summary || thread.summary, is_meaningful: is_meaningful ?? thread.is_meaningful };
        setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => t.id === threadId ? updated : t));
        db.saveThread(updated);
        setSummaryReady(true);
      })
      .catch(() => setSummaryReady(true))
      .finally(() => setLoading(false));
  }, [threadId]);

  const threadTasks = (Array.isArray(tasks) ? tasks : []).filter(t => t.threadId === threadId);
  const dateStr = thread ? new Date(thread.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sourceTag = thread?.source === 'text' ? 'Текст' : thread?.source === 'заметка' ? 'Заметка' : thread?.source === 'skill' ? 'Скилл' : 'Мысль';

  if (!thread) return null;

  return (
    <>
      <style>{`
        @keyframes skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ ...CC, paddingTop: 48, paddingBottom: 60 }}>

          {/* Tag + date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{
              fontFamily: M, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              padding: '4px 10px', borderRadius: 40,
              background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)',
            }}>
              {sourceTag}
            </span>
            <span style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)' }}>{dateStr}</span>
          </div>

          {/* Title */}
          <div style={{ fontFamily: F, fontSize: 32, color: 'var(--text-80)', lineHeight: 1.15, marginBottom: 32 }}>
            {thread.title}
          </div>

          {/* Summary section */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontFamily: M, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-30)', marginBottom: 14 }}>
              Саммари
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SkeletonLine width="90%" />
                <SkeletonLine width="100%" />
                <SkeletonLine width="75%" />
                <div style={{ height: 8 }} />
                <SkeletonLine width="60%" />
                <SkeletonLine width="85%" />
                <SkeletonLine width="50%" />
              </div>
            ) : thread.is_meaningful === false ? (
              <div style={{ fontFamily: M, fontSize: 14, color: 'var(--text-30)', fontStyle: 'italic' }}>
                Эта мысль не попала в архив — слишком короткая или операционная.
              </div>
            ) : summaryReady ? (
              <motion.div
                initial={thread.summary ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                style={{ fontFamily: M, fontSize: 15, color: 'var(--text-80)' }}
              >
                {thread.summary ? renderMarkdown(thread.summary) : 'Нет сообщений для саммари.'}
              </motion.div>
            ) : null}
          </div>

          {/* Tasks from this thread */}
          {threadTasks.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontFamily: M, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-30)', marginBottom: 14 }}>
                Задачи из этой мысли
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden' }}>
                {threadTasks.map((task, idx) => (
                  <div key={task.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                    borderBottom: idx < threadTasks.length - 1 ? '1px solid var(--border)' : undefined,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `1.5px solid ${task.done ? 'var(--text-primary)' : 'var(--text-30)'}`,
                      background: task.done ? 'var(--text-primary)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {task.done && <Check size={9} color="#fff" strokeWidth={2.5} />}
                    </div>
                    <span style={{
                      fontFamily: M, fontSize: 14, flex: 1,
                      color: task.done ? 'var(--text-30)' : 'var(--text-primary)',
                      textDecoration: task.done ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {task.name}
                    </span>
                    {task.time && <span style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)' }}>{task.time}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source content for text drops */}
          {thread.source === 'text' && thread.messages.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontFamily: M, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-30)', marginBottom: 14 }}>
                Сохранённый текст
              </div>
              <div style={{ fontFamily: M, fontSize: 15, color: 'var(--text-80)', lineHeight: 1.75, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', padding: '16px 20px', whiteSpace: 'pre-wrap' }}>
                {thread.messages[0].content}
              </div>
            </div>
          )}

          {/* Switch to chat */}
          {thread.source !== 'text' && (
            <button
              onClick={onSwitchToChat}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontFamily: M, fontSize: 14, color: 'var(--text-primary)',
                background: 'none', border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: 40, padding: '9px 20px', cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            >
              <MessageCircle size={15} strokeWidth={1.5} />
              Открыть диалог
            </button>
          )}

        </div>
      </div>
    </>
  );
}
