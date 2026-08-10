import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, ChevronDown } from 'lucide-react';
import type { GraphNode, GraphNodeStatus } from '../kora/graph';

export type { GraphNode, GraphNodeStatus };

const M = "'Mulish', 'Helvetica Neue', Helvetica, sans-serif";

interface AgentThreadProps {
  nodes: GraphNode[];
  title?: string;
}

const NODE_SIZE = 20;

/** Нода узла графа: done — галочка, running — пульсирующая зелёная точка,
 * queued — пустой кружок, failed — приглушённо-красная точка (#F0B7AC). */
function StepNode({ status }: { status: GraphNodeStatus }) {
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
  if (status === 'running') {
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
  if (status === 'failed') {
    return (
      <div
        style={{
          width: NODE_SIZE, height: NODE_SIZE, borderRadius: '50%',
          border: '1.5px solid rgba(240,183,172,0.5)', background: 'rgba(240,183,172,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: '#F0B7AC',
        }}
      >
        <X size={12} strokeWidth={2.5} />
      </div>
    );
  }
  // queued
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
 * Вертикальный степпер-лог живого графа процесса агента: узлы с соединительной
 * линией слева. Узел с thought — разворачивается по клику (шеврон), внутри —
 * размышление модели + краткая сводка результата инструмента (моноширинным,
 * приглушённым текстом). См. docs/PORTING_TO_TS.md раздел 8.
 */
export default function AgentThread({ nodes, title }: AgentThreadProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!nodes.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {title && (
        <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-30)', marginBottom: 8 }}>
          {title}
        </div>
      )}
      {nodes.map((node, idx) => {
        const isLast = idx === nodes.length - 1;
        const isExpanded = expandedId === node.id;
        const hasThought = !!node.thought;
        return (
          <div key={node.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <StepNode status={node.status} />
                {!isLast && (
                  <div style={{ width: 1, flex: 1, minHeight: 16, background: 'rgba(0,0,0,0.12)' }} />
                )}
              </div>
              <div
                onClick={hasThought ? () => setExpandedId(isExpanded ? null : node.id) : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  minHeight: NODE_SIZE, cursor: hasThought ? 'pointer' : 'default',
                  padding: '0 0 4px',
                }}
              >
                <span
                  style={{
                    fontFamily: M,
                    fontSize: 14,
                    color: node.status === 'running' ? 'var(--text-primary)'
                      : node.status === 'failed' ? '#F0B7AC'
                      : 'var(--text-muted, var(--text-30))',
                  }}
                >
                  {node.label}
                </span>
                {node.detail && (
                  <span style={{ fontFamily: M, fontSize: 12, color: 'var(--text-30)' }}>
                    {node.detail}
                  </span>
                )}
                {hasThought && (
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
            {hasThought && isExpanded && (
              <div style={{ marginLeft: NODE_SIZE + 10, padding: '4px 0 8px' }}>
                <pre
                  style={{
                    fontFamily: "'SFMono-Regular', Consolas, monospace",
                    fontSize: 12, lineHeight: 1.5, color: 'var(--text-30)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                  }}
                >
                  {node.thought}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
