import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import PrimeMascot from './PrimeMascot';

/**
 * Статус-строка агента «Мысль»: маскот + заголовок/подпись + шеврон.
 * Используется в шапке десктоп-сайдбара и (в будущем) в мобильном хедере.
 */

export type AgentState = 'ok' | 'working' | 'needs';

interface AgentStatusProps {
  state: AgentState;
  workingCount?: number;
  collapsed?: boolean;
  onClick?: () => void;
}

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

// Склонение «задача/задачи/задач»
function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} задач`;
  if (mod10 === 1) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} задачи`;
  return `${n} задач`;
}

function getContent(state: AgentState, workingCount: number) {
  switch (state) {
    case 'ok':
      return {
        eyes: 'idle' as const,
        decor: 'none' as const,
        drop: 'none' as const,
        title: 'Всё в порядке',
        subtitle: workingCount > 0 ? `${pluralTasks(workingCount)} в работе` : 'Мысль на связи',
      };
    case 'working':
      return {
        eyes: 'idle' as const,
        decor: 'none' as const,
        drop: 'working' as const,
        title: 'Всё в порядке',
        subtitle: `${pluralTasks(workingCount)} в работе`,
      };
    case 'needs':
      return {
        eyes: 'idle' as const,
        decor: 'question' as const,
        drop: 'needs' as const,
        title: 'Нужна помощь',
        subtitle: 'подтверди действие',
      };
  }
}

export default function AgentStatus({ state, workingCount = 0, collapsed = false, onClick }: AgentStatusProps) {
  const [hovered, setHovered] = useState(false);
  const content = getContent(state, workingCount);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? content.title : undefined}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : 10,
        background: hovered ? 'rgba(0,0,0,0.03)' : 'none',
        border: 'none',
        borderRadius: 12,
        padding: 8,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
    >
      <PrimeMascot size={40} eyes={content.eyes} decor={content.decor} drop={content.drop} />

      {!collapsed && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: M, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {content.title}
            </span>
            <span style={{ fontFamily: M, fontSize: 12, color: 'var(--text-30)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {content.subtitle}
            </span>
          </div>
          <ChevronRight size={16} strokeWidth={1.75} color="var(--text-30)" style={{ flexShrink: 0 }} />
        </>
      )}
    </button>
  );
}
