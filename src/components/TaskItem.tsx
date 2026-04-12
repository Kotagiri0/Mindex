import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Task, SubTask } from '../types';
import { Star, ChevronDown, ChevronRight } from 'lucide-react';

interface TaskItemProps {
  key?: string | number;
  task: Task;
  onToggle: () => void | Promise<void>;
  onClick: () => void | Promise<void>;
  onToggleSubtask?: (taskId: string, subtaskId: string) => void | Promise<void>;
}

export default function TaskItem({ task, onToggle, onClick, onToggleSubtask }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isThought = task.type === 'thought';
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;

  return (
    <motion.div 
      layout
      className="flex flex-col border-b border-border last:border-0 transition-colors"
    >
      <motion.div 
        onClick={onClick}
        layout="position"
        className="flex items-center gap-3 p-[14px_4px] cursor-pointer active:opacity-70 transition-opacity"
        whileHover={{ x: 4 }}
      >
        {hasSubtasks && (
          <motion.button 
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            className="w-6 h-6 flex items-center justify-center text-text-tertiary"
          >
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </motion.div>
          </motion.button>
        )}
        
        <motion.button 
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.8 }}
          className={`w-[26px] h-[26px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
            task.done 
              ? 'bg-accent border-accent glow-primary' 
              : 'bg-transparent border-text-tertiary hover:border-accent'
          }`}
        >
          {isThought ? (
            <motion.div
              animate={{ scale: task.done ? 1 : 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <Star 
                size={14} 
                fill={task.done ? "white" : "transparent"} 
                color={task.done ? "white" : "currentColor"} 
              />
            </motion.div>
          ) : (
            task.done && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-[6px] h-[10px] border-2 border-white border-t-0 border-l-0 rotate-45 -translate-y-[1px]"
              />
            )
          )}
        </motion.button>
        
        <div className="flex-1 flex items-center justify-between min-w-0">
          <motion.span 
            animate={{ 
              opacity: task.done ? 0.6 : 1,
              textDecoration: task.done ? 'line-through' : 'none'
            }}
            transition={{ duration: 0.2 }}
            className={`text-[17px] font-medium text-text-primary truncate transition-colors ${task.done ? 'text-text-tertiary' : ''}`}
          >
            {task.name}
          </motion.span>
          {task.time && (
            <motion.span 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[15px] text-text-secondary font-medium ml-4 flex-shrink-0"
            >
              {task.time}
            </motion.span>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {isExpanded && hasSubtasks && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="pl-12 pr-4 pb-3 flex flex-col gap-2"
          >
            {task.subtasks?.map((st, idx) => (
              <motion.div
                key={st.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                onClick={(e) => { e.stopPropagation(); onToggleSubtask?.(task.id, st.id); }}
                className="flex items-center gap-3 py-1 cursor-pointer"
              >
                <motion.div 
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.8 }}
                  className={`w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center transition-all ${
                    st.done 
                      ? 'bg-accent border-accent' 
                      : 'bg-transparent border-text-tertiary hover:border-accent'
                  }`}
                >
                  {st.done && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-[4px] h-[7px] border-2 border-white border-t-0 border-l-0 rotate-45 -translate-y-[0.5px]"
                    />
                  )}
                </motion.div>
                <motion.span 
                  animate={{ 
                    opacity: st.done ? 0.6 : 1,
                    textDecoration: st.done ? 'line-through' : 'none'
                  }}
                  className={`text-[14px] transition-colors ${st.done ? 'line-through text-text-tertiary' : 'text-text-primary'}`}
                >
                  {st.name}
                </motion.span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
