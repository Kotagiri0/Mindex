import React, { useState } from 'react';
import { Search, Trash2, ChevronRight } from 'lucide-react';
import { Thread, Screen } from '../types';
import { db } from '../lib/db';

interface ThreadsProps {
  threads: Thread[];
  setThreads: (threads: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  onNavigate: (screen: Screen) => void;
  onOpenThread: (id: string) => void;
  onNewThread: () => void;
}

export default function Threads({ threads, setThreads, onNavigate, onOpenThread, onNewThread }: ThreadsProps) {
  const [search, setSearch] = useState('');

  const filtered = threads.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase()) || 
    t.preview.toLowerCase().includes(search.toLowerCase())
  );

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setThreads(prev => prev.filter(t => t.id !== id));
    await db.deleteThread(id);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="safe-top flex-shrink-0" />
      
      <div className="p-[20px_20px_12px] flex-shrink-0">
        <div className="h-[52px] bg-[#EBEBEB]/60 rounded-full flex items-center px-6 gap-3">
          <Search size={18} className="text-[#8E8E93]" strokeWidth={2} />
          <input
            className="flex-1 bg-transparent border-none outline-none font-sans text-[17px] text-[#1C1C1E] placeholder:text-[#8E8E93]"
            placeholder="Поиск по твоим мыслям..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0">
        <div className="px-5 pb-32 flex flex-col">
          {filtered.length === 0 ? (
            <div className="text-center text-[#8E8E93] py-12 px-4 text-[16px]">
              Нет мыслей. Начни новую!
            </div>
          ) : (
            filtered.map((th) => (
              <div
                key={th.id}
                onClick={() => onOpenThread(th.id)}
                className="group py-5 flex items-center cursor-pointer active:opacity-60 transition-opacity border-b border-[#F2F2F7] last:border-none"
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="text-[19px] font-bold text-[#1C1C1E] mb-1 truncate">
                    {th.title}
                  </div>
                  <div className="text-[15px] text-[#8E8E93] leading-[1.4] line-clamp-2">
                    {th.preview || 'Нет сообщений'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => deleteThread(e, th.id)}
                    className="p-2 -m-2 text-[#C7C7CC] hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                  <ChevronRight size={22} className="text-[#C7C7CC] flex-shrink-0" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
