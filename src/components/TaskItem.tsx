import React from 'react';
import { Task } from '../types';

interface TaskItemProps {
  key?: string;
  task: Task;
  onToggle: () => void;
  onClick: () => void;
}

export default function TaskItem({ task, onToggle, onClick }: TaskItemProps) {
  return (
    <div 
      onClick={onClick}
      className="flex items-center gap-4 p-[12px_4px] cursor-pointer active:opacity-70 transition-opacity"
    >
      <button 
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`w-[26px] h-[26px] rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          task.done ? 'bg-[#749BFF] border-[#749BFF]' : 'bg-transparent border-[#A1A1A1]'
        }`}
      >
        {task.done && (
          <div className="w-[6px] h-[10px] border-2 border-white border-t-0 border-l-0 rotate-45 -translate-y-[1px]" />
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
  );
}
