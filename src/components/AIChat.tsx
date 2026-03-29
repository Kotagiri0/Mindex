import React, { useState, useRef, useEffect } from 'react';
import { X, Settings, Send } from 'lucide-react';
import { Thread, Screen, Message, Task } from '../types';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';

interface AIChatProps {
  threadId: string | null;
  threads: Thread[];
  setThreads: (threads: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
}

export default function AIChat({ threadId, threads, setThreads, tasks, setTasks, onClose, onNavigate }: AIChatProps) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const thread = threads.find(t => t.id === threadId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.messages, isTyping]);

  const ft = () => {
    const n = new Date();
    return n.getHours().toString().padStart(2, '0') + ':' + n.getMinutes().toString().padStart(2, '0');
  };

  const handleSend = async () => {
    if (!input.trim() || !threadId) return;
    
    const text = input.trim();
    setInput('');
    
    const userMsg: Message = { role: 'user', content: text, time: ft() };
    
    let updatedThread: Thread | undefined;

    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        updatedThread = {
          ...t,
          messages: [...t.messages, userMsg],
          preview: text.length > 60 ? text.slice(0, 60) + '…' : text
        };
        return updatedThread;
      }
      return t;
    }));
    
    if (updatedThread) {
      db.saveThread(updatedThread);
    }
    
    setIsTyping(true);

    try {
      // Get latest messages for the thread
      const currentThread = threads.find(t => t.id === threadId);
      if (!currentThread) return;
      
      // Build conversation history
      let conversationHistory: Message[] = [...currentThread.messages, userMsg];

      const turnMessages: Message[] = [];

      let response = await generateResponse(conversationHistory);
      
      // Handle function calls
      while (response.tool_calls) {
        const toolResults: Message[] = [];
        
        const assistantToolCallMsg: Message = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
          time: ft()
        };
        turnMessages.push(assistantToolCallMsg);

        for (const call of response.tool_calls) {
          const { name } = call.function;
          const args = JSON.parse(call.function.arguments);
          const id = call.id;
          let result;
          
          if (name === 'get_tasks') {
            const date = args.date;
            const filtered = date ? tasks.filter(t => t.date === date) : tasks;
            result = filtered.length > 0 ? filtered : "Задач не найдено.";
          } else if (name === 'add_task') {
            const { name: taskName, time, date } = args;
            const newTask: Task = {
              id: crypto.randomUUID(),
              name: taskName,
              time: time || '',
              date: date || new Date().toISOString().split('T')[0],
              done: false,
              threadId: threadId || undefined
            };
            setTasks(prev => [...prev, newTask]);
            db.saveTask(newTask);
            result = { status: "success", task: newTask };
          } else if (name === 'update_task') {
            const { id: taskId, done, name: taskName, time, date } = args;
            setTasks(prev => prev.map(t => {
              if (t.id === taskId) {
                const updated = { 
                  ...t, 
                  done: done !== undefined ? done : t.done, 
                  name: taskName || t.name,
                  time: time !== undefined ? time : t.time,
                  date: date !== undefined ? date : t.date
                };
                db.saveTask(updated);
                return updated;
              }
              return t;
            }));
            result = { status: "success" };
          } else if (name === 'delete_task') {
            const { id: taskId } = args;
            setTasks(prev => prev.filter(t => t.id !== taskId));
            db.deleteTask(taskId);
            result = { status: "success" };
          }
          
          toolResults.push({
            role: "tool",
            tool_call_id: id,
            content: JSON.stringify(result),
            time: ft()
          });
        }
        
        turnMessages.push(...toolResults);

        // Add the assistant message with tool calls and the tool results to history
        conversationHistory = [
          ...conversationHistory,
          assistantToolCallMsg,
          ...toolResults
        ];

        // Get next response from model
        response = await generateResponse(conversationHistory);
      }

      const assistantMsg: Message = { role: 'assistant', content: response.content || 'Готово!', time: ft() };
      
      setThreads(prev => prev.map(t => {
        if (t.id === threadId) {
          // Ensure user message is in history (fix for race conditions in some environments)
          const hasUserMsg = t.messages.some(
            m => m.role === 'user' && m.content === userMsg.content && m.time === userMsg.time
          );
          const baseMessages = hasUserMsg ? t.messages : [...t.messages, userMsg];
          
          const updated = {
            ...t,
            messages: [...baseMessages, ...turnMessages, assistantMsg],
            preview: assistantMsg.content.slice(0, 60) + '…'
          };
          db.saveThread(updated);
          return updated;
        }
        return t;
      }));
    } catch (err: any) {
      console.error('AI Error:', err);
      const errorMsg: Message = { 
        role: 'assistant', 
        content: `Ошибка: ${err.message || 'Не удалось связаться с ИИ. Проверь интернет или настройки.'}`, 
        time: ft() 
      };
      if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
        errorMsg.content = "Ошибка сети: Не удалось отправить запрос (возможно, заблокировано WebView или нет интернета).";
      }
      setThreads(prev => prev.map(t => {
        if (t.id === threadId) {
          const hasUserMsg = t.messages.some(
            m => m.role === 'user' && m.content === userMsg.content && m.time === userMsg.time
          );
          const baseMessages = hasUserMsg ? t.messages : [...t.messages, userMsg];
          
          const updated = { ...t, messages: [...baseMessages, errorMsg] };
          db.saveThread(updated);
          return updated;
        }
        return t;
      }));
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="p-[12px_16px] flex items-center justify-between border-b border-border flex-shrink-0 pt-[max(12px,env(safe-area-inset-top,12px))]">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-text-secondary active:bg-border transition-colors">
          <X size={18} />
        </button>
        <span className="text-[20px] font-extrabold text-accent">
          {thread.title === 'Новая мысль' ? 'Мысль' : thread.title}
        </span>
        <button onClick={() => onNavigate('settings')} className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-text-secondary active:bg-border transition-colors">
          <Settings size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[20px_16px_8px] flex flex-col gap-3 scrollbar-hide min-h-0">
        {thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls).length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <div className="text-[28px] font-extrabold text-text-primary text-center leading-[1.25]">
              Привет!<br />Есть мысли?
            </div>
            <div className="text-[15px] text-text-tertiary text-center">
              Поделись тем, что на уме
            </div>
          </div>
        ) : (
          thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls).map((m, i) => (
            <div key={i} className={`flex flex-col max-w-[80%] gap-[3px] ${m.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
              <div className={`p-[10px_14px] rounded-[18px] text-[15px] leading-[1.5] ${
                m.role === 'user' ? 'bg-accent text-white rounded-br-[4px]' : 'bg-surface2 text-text-primary rounded-bl-[4px]'
              }`}>
                {m.content}
              </div>
              <div className="text-[11px] text-text-tertiary px-1">{m.time}</div>
            </div>
          ))
        )}
        
        {isTyping && (
          <div className="flex flex-col max-w-[80%] gap-[3px] self-start items-start">
            <div className="flex gap-1 p-[11px_15px] bg-surface2 rounded-[18px] rounded-bl-[4px] w-fit">
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" />
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.2s]" />
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      <div className="p-[10px_14px] pb-[calc(10px+env(safe-area-inset-bottom,0px))] flex items-center gap-2.5 bg-surface border-t border-border flex-shrink-0">
        <input
          className="flex-1 h-11 bg-surface2 border-[1.5px] border-transparent rounded-[22px] px-4 font-sans text-[15px] text-text-primary outline-none focus:border-accent focus:bg-white transition-all placeholder:text-text-tertiary"
          placeholder="Что думаешь? Пиши сюда"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
        />
        <button
          disabled={!input.trim() || isTyping}
          onClick={handleSend}
          className="w-11 h-11 rounded-full bg-accent flex items-center justify-center disabled:bg-border transition-colors flex-shrink-0"
        >
          <Send size={18} color="white" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
