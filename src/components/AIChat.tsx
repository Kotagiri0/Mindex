import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Settings, Send, Check, ChevronDown, ChevronRight, Star, Plus, ArrowUp, MessageCircle, StickyNote } from 'lucide-react';
import { Thread, Screen, Message, Task, SubTask } from '../types';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

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

  if (!thread) return null;

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
              id: uuid(),
              name: taskName,
              time: time || '',
              date: date || new Date().toISOString().split('T')[0],
              done: false,
              threadId: threadId || undefined
            };
            setTasks(prev => [...prev, newTask]);
            db.saveTask(newTask);
            result = { status: "success", task: newTask };
          } else if (name === 'start_planning') {
            const { questions } = args;
            const planningMsg: Message = {
              role: 'assistant',
              content: 'Чтобы составить лучший план, мне нужно уточнить пару деталей:',
              time: ft(),
              planning_data: {
                questions,
                status: 'questionnaire'
              }
            };
            setThreads(prev => prev.map(t => {
              if (t.id === threadId) {
                const updated = { ...t, messages: [...t.messages, planningMsg] };
                db.saveThread(updated);
                return updated;
              }
              return t;
            }));
            setIsTyping(false);
            return; // Stop the standard flow, wait for user input
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

  const handleAnswer = async (msgIndex: number, questionId: string, answer: string) => {
    if (!threadId) return;
    
    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const msg = { ...newMessages[msgIndex] };
        if (msg.planning_data) {
          msg.planning_data = {
            ...msg.planning_data,
            answers: { ...msg.planning_data.answers, [questionId]: answer }
          };
          
          // If all questions are answered, move to plan generation
          const allAnswered = msg.planning_data.questions.every(q => 
            msg.planning_data?.answers?.[q.id] || q.id === questionId
          );
          
          if (allAnswered) {
            msg.planning_data.status = 'plan_generated';
            // Trigger AI to generate plan based on answers
            setTimeout(() => generatePlanFromAnswers(t, msg.planning_data!), 100);
          }
        }
        newMessages[msgIndex] = msg;
        const updated = { ...t, messages: newMessages };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const generatePlanFromAnswers = async (t: Thread, planningData: any) => {
    setIsTyping(true);
    try {
      const answersText = Object.entries(planningData.answers)
        .map(([id, ans]) => {
          const q = planningData.questions.find((q: any) => q.id === id);
          return `Вопрос: ${q?.question}\nОтвет: ${ans}`;
        }).join('\n\n');

      const prompt = `Пользователь ответил на уточняющие вопросы:\n\n${answersText}\n\nНа основе этих ответов составь пошаговый план действий (to-do list).
Отвечай СТРОГО в формате JSON:
{
  "title": "Название плана",
  "steps": ["шаг 1", "шаг 2", ...]
}`;

      const response = await generateResponse([
        ...t.messages,
        { role: 'user', content: prompt, time: ft() }
      ], { tool_choice: 'none' });

      if (!response || !response.content) {
        throw new Error('AI вернул пустой ответ при генерации плана.');
      }

      // Extract JSON from response content (in case it's wrapped in markdown)
      let jsonContent = response.content.trim();
      if (jsonContent.includes('```json')) {
        jsonContent = jsonContent.split('```json')[1].split('```')[0].trim();
      } else if (jsonContent.includes('```')) {
        jsonContent = jsonContent.split('```')[1].split('```')[0].trim();
      }

      const plan = JSON.parse(jsonContent);
      
      setThreads(prev => prev.map(th => {
        if (th.id === threadId) {
          const newMessages = [...th.messages];
          const lastMsg = { ...newMessages[newMessages.length - 1] };
          if (lastMsg.planning_data) {
            lastMsg.planning_data = {
              ...lastMsg.planning_data,
              plan,
              status: 'plan_generated'
            };
          }
          newMessages[newMessages.length - 1] = lastMsg;
          const updated = { ...th, messages: newMessages };
          db.saveThread(updated);
          return updated;
        }
        return th;
      }));
    } catch (err) {
      console.error('Plan generation error:', err);
    } finally {
      setIsTyping(false);
    }
  };

  const handleAcceptPlan = async (msgIndex: number) => {
    if (!threadId || !thread) return;
    const msg = thread.messages[msgIndex];
    if (!msg.planning_data?.plan) return;

    const { title, steps } = msg.planning_data.plan;
    const subtasks: SubTask[] = steps.map(s => ({
      id: uuid(),
      name: s,
      done: false
    }));

    const newTask: Task = {
      id: uuid(),
      name: title,
      time: '',
      date: new Date().toISOString().split('T')[0],
      done: false,
      threadId: threadId,
      type: 'thought',
      subtasks
    };

    setTasks(prev => [...prev, newTask]);
    db.saveTask(newTask);

    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data) {
          m.planning_data.status = 'accepted';
        }
        newMessages[msgIndex] = m;
        const updated = { ...t, messages: [...newMessages, { 
          role: 'assistant' as const, 
          content: 'Отлично! План добавлен в календарь. Ты найдешь его в списке задач со звездочкой.', 
          time: ft() 
        }] };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const handleRejectPlan = (msgIndex: number) => {
    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data) {
          m.planning_data.status = 'rejected';
        }
        newMessages[msgIndex] = m;
        const updated = { ...t, messages: [...newMessages, { 
          role: 'assistant' as const, 
          content: 'Хорошо, давай попробуем по-другому или просто продолжим общение.', 
          time: ft() 
        }] };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const updatePlanStep = (msgIndex: number, stepIndex: number, newName: string) => {
    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        const newMessages = [...t.messages];
        const m = { ...newMessages[msgIndex] };
        if (m.planning_data?.plan) {
          const newSteps = [...m.planning_data.plan.steps];
          newSteps[stepIndex] = newName;
          m.planning_data.plan.steps = newSteps;
        }
        newMessages[msgIndex] = m;
        const updated = { ...t, messages: newMessages };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#f0f0f0' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 flex-shrink-0"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', paddingBottom: '12px' }}
      >
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center"
        >
          <ChevronLeft size={24} strokeWidth={1.75} color="#222224" />
        </motion.button>

        {/* Chat / Note toggle */}
        <div className="flex items-center gap-0.5 rounded-full p-1" style={{ background: '#ffffff' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#ffffff' }}>
            <MessageCircle size={20} strokeWidth={1.75} color="#222224" />
          </div>
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center"
            onClick={() => alert('Заметки будут в ближайших обновлениях')}
          >
            <StickyNote size={20} strokeWidth={1.75} color="rgba(34,34,36,0.3)" />
          </button>
        </div>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate('settings')}
          className="w-11 h-11 flex items-center justify-center"
        >
          <Settings size={22} strokeWidth={1.75} color="rgba(34,34,36,0.5)" />
        </motion.button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[20px_16px_8px] flex flex-col gap-3 scrollbar-hide min-h-0">
        {thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls).length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <div className="text-[28px] font-extrabold text-center leading-[1.25]" style={{ color: '#222224' }}>
              Привет!<br />Есть мысли?
            </div>
            <div className="text-[15px] text-center" style={{ color: '#888888' }}>
              Поделись тем, что на уме
            </div>
          </div>
        ) : (
          thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls).map((m, i) => (
            <div key={i} className={`flex flex-col max-w-[85%] gap-[3px] ${m.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
              <div className={`p-[10px_14px] rounded-[18px] text-[15px] leading-[1.5] ${
                m.role === 'user' ? 'bg-accent text-white rounded-br-[4px]' : 'rounded-bl-[4px]'
              }`}
              style={{
                background: m.role === 'user' ? undefined : '#f5f5f5',
                color: m.role === 'user' ? undefined : '#222224'
              }}>
                {m.content}
                
                {m.planning_data && (
                  <div className="mt-3 flex flex-col gap-3">
                    {m.planning_data.status === 'questionnaire' && (
                      <div className="flex flex-col gap-4">
                        {m.planning_data.questions.map((q) => {
                          const isAnswered = m.planning_data?.answers?.[q.id];
                          if (isAnswered) return (
                            <div key={q.id} className="p-2 rounded-lg text-[13px] border" style={{ background: '#f5f5f5', color: '#222224', borderColor: '#e0e0e0' }}>
                              <div className="text-[11px] mb-1" style={{ color: '#666666' }}>{q.question}</div>
                              <div className="font-semibold">{m.planning_data?.answers?.[q.id]}</div>
                            </div>
                          );
                          
                          return (
                            <div key={q.id} className="flex flex-col gap-2">
                              <div className="text-[14px] font-bold text-text-primary">{q.question}</div>
                              <div className="grid grid-cols-1 gap-1.5">
                                {q.options.map((opt) => (
                                  <button
                                    key={opt}
                                    onClick={() => handleAnswer(i, q.id, opt)}
                                    className="text-left p-2 rounded-xl text-[13px] active:scale-95 transition-transform border transition-colors"
                                    style={{ background: '#ffffff', color: '#222224', borderColor: '#e0e0e0' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#ffffff')}
                                  >
                                    {opt}
                                  </button>
                                ))}
                                <div className="relative">
                                  <input 
                                    placeholder="Свой вариант..."
                                    className="w-full p-2 rounded-xl text-[13px] border outline-none transition-colors"
                                    style={{ background: '#ffffff', color: '#222224', borderColor: '#e0e0e0' }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                        handleAnswer(i, q.id, (e.target as HTMLInputElement).value.trim());
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {m.planning_data.status === 'plan_generated' && m.planning_data.plan && (
                        <div className="rounded-2xl p-4 shadow-sm border flex flex-col gap-3 transition-colors" style={{ background: '#f5f5f5', borderColor: '#e0e0e0' }}>
                        <div className="text-[16px] font-bold flex items-center gap-2" style={{ color: '#222224' }}>
                          <Star size={18} fill="#222224" />
                          {m.planning_data.plan.title}
                        </div>
                        <div className="flex flex-col gap-2">
                          {m.planning_data.plan.steps.map((step, sIdx) => (
                            <div key={sIdx} className="flex items-start gap-2 group">
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 flex-shrink-0" style={{ background: '#e6e6ff', color: '#222224' }}>
                                {sIdx + 1}
                              </div>
                              <input 
                                value={step}
                                onChange={(e) => updatePlanStep(i, sIdx, e.target.value)}
                                className="flex-1 bg-transparent text-[13px] outline-none"
                                style={{ color: '#222224' }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button 
                            onClick={() => handleAcceptPlan(i)}
                            className="flex-1 h-10 text-white rounded-xl text-[13px] font-bold active:scale-95 transition-transform"
                            style={{ background: '#222224' }}
                          >
                            Принять
                          </button>
                          <button 
                            onClick={() => handleRejectPlan(i)}
                            className="flex-1 h-10 rounded-xl text-[13px] font-bold active:scale-95 transition-transform border"
                            style={{ background: '#ffffff', color: '#222224', borderColor: '#e0e0e0' }}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-text-tertiary px-1">{m.time}</div>
            </div>
          ))
        )}
        
        {isTyping && (
          <div className="flex flex-col max-w-[80%] gap-[3px] self-start items-start">
            <div className="flex gap-1 p-[11px_15px] rounded-[18px] rounded-bl-[4px] w-fit" style={{ background: '#f5f5f5' }}>
              <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#999999' }} />
              <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0.2s]" style={{ background: '#999999' }} />
              <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0.4s]" style={{ background: '#999999' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input card */}
      <div
        className="px-4 flex-shrink-0"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}
      >
        <div className="rounded-[20px] p-4" style={{ background: '#ffffff' }}>
          <input
            className="w-full bg-transparent outline-none"
            style={{
              fontFamily: "'Random Grotesque', sans-serif",
              fontSize: '16px',
              color: '#222224',
            }}
            placeholder="Есть мысли?"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          />
          <div className="flex items-center justify-between mt-3">
            <button
              className="w-9 h-9 flex items-center justify-center"
              onClick={() => alert('Вложения будут в ближайших обновлениях')}
            >
              <Plus size={22} strokeWidth={1.75} color="rgba(34,34,36,0.35)" />
            </button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              disabled={!input.trim() || isTyping}
              onClick={handleSend}
              className="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
              style={{ background: input.trim() && !isTyping ? '#222224' : 'rgba(34,34,36,0.15)' }}
            >
              <ArrowUp size={20} strokeWidth={2} color="#ffffff" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
