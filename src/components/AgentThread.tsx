import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

export type AgentThreadStepStatus = 'done' | 'active' | 'pending';

export interface AgentThreadStep {
  id: string;
  label: string;
  status: AgentThreadStepStatus;
  /** Необязательный раскрывающийся под-список (детали шага). */
  subItems?: string[];
}

interface AgentThreadProps {
  steps: AgentThreadStep[];
  title?: string;
}

const NODE_SIZE = 20;

/** Нода шага: done — галочка в приглушённой обводке, active — пульсирующая точка, pending — пустой кружок. */
function StepNode({ status }: { status: AgentThreadStepStatus }) {
  if (status === 'done') {
    return (
      <div
        style={{
          width: NODE_SIZE, height: NODE_SIZE, borderRadius: '50%',
          border: '1.5px solid rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: 'var(--text-30)',
        }}
      >
        <Check size={12} strokeWidth={2.5} />
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div style={{ position: 'relative', width: NODE_SIZE, height: NODE_SIZE, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <motion.span
          style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: '#9FDFAE' }}
          animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
        />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#9FDFAE' }} />
      </div>
    );
  }
  // pending
  return (
    <div
      style={{
        width: NODE_SIZE, height: NODE_SIZE, borderRadius: '50%',
        border: '1.5px solid rgba(0,0,0,0.15)', flexShrink: 0,
      }}
    />
  );
}

/**
 * Вертикальный степпер-лог исполнения агента: шаги с соединительной линией слева.
 * Первый шаг может иметь раскрывающийся под-список деталей.
 */
export default function AgentThread({ steps, title }: AgentThreadProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {title && (
        <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)', marginBottom: 8 }}>
          {title}
        </div>
      )}
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const isExpanded = expandedId === step.id;
        const hasSub = !!step.subItems?.length;
        return (
          <div key={step.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <StepNode status={step.status} />
                {!isLast && (
                  <div style={{ width: 1, flex: 1, minHeight: 16, background: 'rgba(0,0,0,0.12)' }} />
                )}
              </div>
              <div
                onClick={hasSub ? () => setExpandedId(isExpanded ? null : step.id) : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  height: NODE_SIZE, cursor: hasSub ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{
                    fontFamily: M,
                    fontSize: 14,
                    color: step.status === 'active' ? 'var(--text-primary)' : 'var(--text-muted, var(--text-30))',
                  }}
                >
                  {step.label}
                </span>
                {hasSub && (
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: 'flex', color: 'var(--text-30)' }}
                  >
                    <ChevronDown size={14} />
                  </motion.span>
                )}
              </div>
            </div>
            {hasSub && isExpanded && (
              <div style={{ marginLeft: NODE_SIZE + 10, padding: '4px 0 8px' }}>
                {step.subItems!.map((item, i) => (
                  <div key={i} style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)', padding: '2px 0' }}>
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
