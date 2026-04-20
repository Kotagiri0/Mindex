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

const F = "'Random Grotesque', sans-serif";

export default function TaskItem({ task, onToggle, onClick, onToggleSubtask }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;

  return (
    <div style={{ borderBottom: '1px solid rgba(34,34,36,0.08)' }}>
      <div
        className="flex items-center gap-4 py-4 cursor-pointer active:opacity-60 transition-opacity"
        onClick={onClick}
      >
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className="flex-shrink-0 flex items-center justify-center"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: `2px solid ${task.done ? '#222224' : 'rgba(34,34,36,0.28)'}`,
            background: task.done ? '#222224' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          {task.done && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.15 }}>
              <Check size={13} color="#ffffff" strokeWidth={2.5} />
            </motion.div>
          )}
        </motion.button>

        <span
          className="flex-1 truncate"
          style={{
            fontFamily: F,
            fontSize: '17px',
            color: task.done ? 'rgba(34,34,36,0.35)' : '#222224',
            textDecoration: task.done ? 'line-through' : 'none',
            transition: 'color 0.15s',
          }}
        >
          {task.name}
        </span>

        {task.time && (
          <span style={{ fontFamily: F, fontSize: '14px', color: 'rgba(34,34,36,0.4)', flexShrink: 0 }}>
            {task.time}
          </span>
        )}

        {hasSubtasks && (
          <motion.button
            onClick={e => { e.stopPropagation(); setIsExpanded(v => !v); }}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0"
          >
            <ChevronDown size={18} color="rgba(34,34,36,0.35)" />
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
            className="pl-12 pb-3 flex flex-col gap-2"
          >
            {task.subtasks?.map(st => (
              <div
                key={st.id}
                onClick={e => { e.stopPropagation(); onToggleSubtask?.(task.id, st.id); }}
                className="flex items-center gap-3 py-1 cursor-pointer"
              >
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: `1.5px solid ${st.done ? '#222224' : 'rgba(34,34,36,0.25)'}`,
                    background: st.done ? '#222224' : 'transparent',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  {st.done && <Check size={11} color="#ffffff" strokeWidth={2.5} />}
                </div>
                <span style={{
                  fontFamily: F,
                  fontSize: '14px',
                  color: st.done ? 'rgba(34,34,36,0.35)' : '#222224',
                  textDecoration: st.done ? 'line-through' : 'none',
                }}
                >
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
