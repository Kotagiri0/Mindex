import React, { useState } from 'react';
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
    <div className="flex flex-col border-b border-[#F2F2F7] last:border-0">
      <div 
        onClick={onClick}
        className="flex items-center gap-3 p-[14px_4px] cursor-pointer active:opacity-70 transition-opacity"
      >
        {hasSubtasks && (
          <button 
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            className="w-6 h-6 flex items-center justify-center text-[#8E8E93]"
          >
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        )}
        
        <button 
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`w-[26px] h-[26px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            task.done ? 'bg-[#749BFF] border-[#749BFF]' : 'bg-transparent border-[#A1A1A1]'
          }`}
        >
          {isThought ? (
            <Star size={14} fill={task.done ? "white" : "transparent"} color={task.done ? "white" : "#A1A1A1"} />
          ) : (
            task.done && (
              <div className="w-[6px] h-[10px] border-2 border-white border-t-0 border-l-0 rotate-45 -translate-y-[1px]" />
            )
          )}
        </button>
        
        <div className="flex-1 flex items-center justify-between min-w-0">
          <span className={`text-[17px] font-medium text-[#1C1C1E] truncate transition-all ${task.done ? 'line-through text-[#8E8E93]' : ''}`}>
            {task.name}
          </span>
          {task.time && (
            <span className="text-[15px] text-[#8E8E93] font-medium ml-4 flex-shrink-0">
              {task.time}
            </span>
          )}
        </div>
      </div>

      {isExpanded && hasSubtasks && (
        <div className="pl-12 pr-4 pb-3 flex flex-col gap-2">
          {task.subtasks.map((st) => (
            <div 
              key={st.id}
              onClick={(e) => { e.stopPropagation(); onToggleSubtask?.(task.id, st.id); }}
              className="flex items-center gap-3 py-1 cursor-pointer"
            >
              <div className={`w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center ${
                st.done ? 'bg-[#749BFF] border-[#749BFF]' : 'bg-transparent border-[#A1A1A1]'
              }`}>
                {st.done && <div className="w-[4px] h-[7px] border-2 border-white border-t-0 border-l-0 rotate-45 -translate-y-[0.5px]" />}
              </div>
              <span className={`text-[14px] ${st.done ? 'line-through text-[#8E8E93]' : 'text-[#3C3C43]'}`}>
                {st.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
