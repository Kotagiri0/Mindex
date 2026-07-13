import React from 'react';
import { motion } from 'motion/react';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

export type AgentTaskCardStatus = 'done' | 'working' | 'needs' | 'pending';

export interface AgentTaskCardItem {
  id: string;
  name: string;
  status: AgentTaskCardStatus;
  time?: string;
}

interface AgentTaskCardProps {
  tasks: AgentTaskCardItem[];
  onClose?: () => void;
}

/**
 * Точка-индикатор статуса задачи агента.
 * done — залитая зелёная, working — залитая жёлтая,
 * needs — жёлтая с пульсацией (ждёт пользователя), pending — пустой кружок с обводкой.
 */
function StatusDot({ status }: { status: AgentTaskCardStatus }) {
  const size = 8;
  if (status === 'done') {
    return (
      <span style={{ width: size, height: size, borderRadius: '50%', background: '#9FDFAE', flexShrink: 0 }} />
    );
  }
  if (status === 'working') {
    return (
      <span style={{ width: size, height: size, borderRadius: '50%', background: '#F5D879', flexShrink: 0 }} />
    );
  }
  if (status === 'needs') {
    return (
      <span style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <motion.span
          style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#F5D879' }}
          animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
        />
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#F5D879' }} />
      </span>
    );
  }
  // pending — пустой кружок
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%',
        border: '1.5px solid rgba(0,0,0,0.2)', background: 'transparent', flexShrink: 0,
      }}
    />
  );
}

/**
 * Плавающая карточка со списком задач, которые ведёт агент «Мысль».
 * Чистый презентационный компонент — данные приходят пропсами.
 */
export default function AgentTaskCard({ tasks, onClose }: AgentTaskCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        padding: '12px 8px',
        maxWidth: 360,
        width: '100%',
      }}
    >
      {onClose && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px 4px' }}>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-30)', padding: 4, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {tasks.map(task => (
          <div
            key={task.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
            }}
          >
            <StatusDot status={task.status} />
            <span
              style={{
                flex: 1,
                fontFamily: M,
                fontSize: 14,
                color: task.status === 'done' ? 'var(--text-30)' : 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {task.name}
            </span>
            {task.time && (
              <span style={{ fontSize: 13, color: 'var(--text-30)', flexShrink: 0 }}>
                {task.time}
              </span>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
