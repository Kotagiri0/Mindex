import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Task } from '../types';
import { Check, ChevronDown } from 'lucide-react';

interface TaskItemProps {
  key?: string | number;
  task: Task;
  onToggle: () => void | Promise<void>;
  onClick: () => void | Promise<void>;
  onToggleSubtask?: (taskId: string, subtaskId: string) => void | Promise<void>;
}

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

export default function TaskItem({ task, onToggle, onClick, onToggleSubtask }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', cursor: 'pointer' }}
        onClick={onClick}
      >
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={e => { e.stopPropagation(); onToggle(); }}
          style={{
            flexShrink: 0,
            width: 26, height: 26,
            borderRadius: '50%',
            border: `1.5px solid ${task.done ? '#222224' : 'rgba(34,34,36,0.25)'}`,
            background: task.done ? '#222224' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >
          {task.done && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.15 }}>
              <Check size={11} color="#ffffff" strokeWidth={2.5} />
            </motion.div>
          )}
        </motion.button>

        <span
          style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: M, fontSize: 15, fontWeight: 400,
            color: task.done ? 'rgba(34,34,36,0.35)' : '#222224',
            textDecoration: task.done ? 'line-through' : 'none',
            transition: 'color 0.15s',
          }}
        >
          {task.name}
        </span>

        {task.time && (
          <span style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.4)', flexShrink: 0 }}>
            {task.time}{task.endTime ? ` – ${task.endTime}` : ''}
          </span>
        )}

        {hasSubtasks && (
          <motion.button
            onClick={e => { e.stopPropagation(); setIsExpanded(v => !v); }}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, display: 'flex' }}
          >
            <ChevronDown size={16} color="rgba(34,34,36,0.35)" />
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {isExpanded && hasSubtasks && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ paddingLeft: 38, paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {task.subtasks?.map(st => (
              <div
                key={st.id}
                onClick={e => { e.stopPropagation(); onToggleSubtask?.(task.id, st.id); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', cursor: 'pointer' }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${st.done ? '#222224' : 'rgba(34,34,36,0.25)'}`,
                  background: st.done ? '#222224' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {st.done && <Check size={9} color="#ffffff" strokeWidth={2.5} />}
                </div>
                <span style={{
                  fontFamily: M, fontSize: 13,
                  color: st.done ? 'rgba(34,34,36,0.35)' : '#222224',
                  textDecoration: st.done ? 'line-through' : 'none',
                }}>
                  {st.name}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
