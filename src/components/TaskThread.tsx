import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { Task, Thread } from '../types';
import PrimeMascot from './PrimeMascot';
import AgentThread from './AgentThread';
import type { GraphNode } from '../kora/graph';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

interface TaskThreadProps {
  task: Task;
  thread: Thread | null;
  onSend: (text: string) => void;
  busy?: boolean;
  liveGraph?: GraphNode[] | null;
}

/**
 * Тред задачи — компактный лог + поле ответа. Живёт ВНУТРИ панели/sheet задачи
 * (не отдельный экран): один и тот же компонент — для мобильного bottom sheet
 * и десктопной боковой панели, чтобы поведение не расходилось между поверхностями.
 */
export default function TaskThread({ task, thread, onSend, busy, liveGraph }: TaskThreadProps) {
  const [value, setValue] = useState('');
  const messages = thread?.messages || [];

  const handleSend = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PrimeMascot size={28} eyes="idle" decor="none" drop={task.agent || 'none'} />
        <span style={{ fontFamily: M, fontSize: 13, fontWeight: 500, color: 'rgba(34,34,36,0.55)' }}>
          {task.agent ? 'Мысль ведёт задачу' : 'Мысль на связи'}
        </span>
      </div>

      {/* Лог сообщений треда */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
        {messages.length === 0 && !busy && (
          <div style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.35)', padding: '2px 0 4px' }}>
            Спроси Мысль об этой задаче…
          </div>
        )}
        {messages.map((m, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.role === 'user' ? (
              <div
                style={{
                  maxWidth: '85%',
                  background: '#222224',
                  color: '#fff',
                  borderRadius: '14px 14px 4px 14px',
                  padding: '8px 12px',
                  fontFamily: M,
                  fontSize: 14,
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            ) : (
              <div style={{ maxWidth: '100%', width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.content && (
                  <div
                    style={{
                      fontFamily: M, fontSize: 14, lineHeight: 1.45, color: '#222224',
                      wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.content}
                  </div>
                )}
                {m.graph && m.graph.length > 0 && <AgentThread nodes={m.graph as any} />}
              </div>
            )}
          </div>
        ))}
        {busy && liveGraph && liveGraph.length > 0 && <AgentThread nodes={liveGraph as any} />}
        {busy && (!liveGraph || liveGraph.length === 0) && (
          <motion.div
            animate={{ opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.4)' }}
          >
            Мысль думает…
          </motion.div>
        )}
      </div>

      {/* Поле ввода */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#f5f5f5', borderRadius: 12, padding: '4px 4px 4px 12px',
        }}
      >
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Спросить Мысль…"
          disabled={busy}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: M, fontSize: 14, color: '#222224',
          }}
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleSend}
          disabled={busy || !value.trim()}
          aria-label="Отправить"
          style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: value.trim() && !busy ? '#222224' : 'rgba(34,34,36,0.15)',
            border: 'none', cursor: value.trim() && !busy ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
        >
          <ArrowUp size={14} color="#fff" strokeWidth={2} />
        </motion.button>
      </div>
    </div>
  );
}
