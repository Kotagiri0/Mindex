import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Settings, Star, Plus, ArrowUp, MessageCircle, StickyNote, Mic, Loader, Copy, MoreHorizontal, X } from 'lucide-react';
import NoteView from './NoteView';
import { Thread, Screen, Message, Task, SubTask } from '../types';
import { generateResponse } from '../lib/groq';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useVoiceInput } from '../lib/useVoiceInput';

interface AIChatProps {
  threadId: string | null;
  threads: Thread[];
  setThreads: (threads: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  tasks: Task[];
  setTasks: (tasks: Task[] | ((prev: Task[]) => Task[])) => void;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
  autoSend?: string;
  onAutoSentClear?: () => void;
}

export default function AIChat({ threadId, threads, setThreads, tasks, setTasks, onClose, onNavigate, autoSend, onAutoSentClear }: AIChatProps) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const [animatingContent, setAnimatingContent] = useState<string | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [openMsgMenuIdx, setOpenMsgMenuIdx] = useState<number | null>(null);
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const [isTouchDevice] = useState(() => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIsTypingRef = useRef(false);

  const THINKING_PHRASES = ['Думаю...', 'Анализирую...', 'Ищу в архиве...', 'Формулирую...', 'Пишу ответ...'];

  useEffect(() => {
    if (!isTyping) return;
    const iv = setInterval(() => setThinkingIdx(p => (p + 1) % THINKING_PHRASES.length), 1800);
    return () => clearInterval(iv);
  }, [isTyping]);

  useEffect(() => {
    if (prevIsTypingRef.current && !isTyping) {
      const visibleMsgs = (thread?.messages || []).filter(m => m.role !== 'tool' && !m.tool_calls);
      const last = visibleMsgs[visibleMsgs.length - 1];
      if (last?.role === 'assistant' && last.content) {
        const fullText = last.content;
        let i = 0;
        setAnimatingContent('');
        if (animIntervalRef.current) clearInterval(animIntervalRef.current);
        animIntervalRef.current = setInterval(() => {
          i += 6;
          if (i >= fullText.length) {
            clearInterval(animIntervalRef.current!);
            setAnimatingContent(null);
          } else {
            setAnimatingContent(fullText.slice(0, i));
          }
        }, 10);
      }
    }
    prevIsTypingRef.current = isTyping;
  }, [isTyping]);

  const { state: voiceState, error: voiceError, startRecording, stopRecording } = useVoiceInput(
    (text) => {
      setInput(prev => prev + (prev ? ' ' : '') + text);
    }
  );

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

  const sendText = async (text: string) => {
    if (!text || !threadId) return;

    const userMsg: Message = { role: 'user', content: text, time: ft() };
    const isFirstMessage = thread.messages.length === 0;

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
      const currentThread = threads.find(t => t.id === threadId);
      if (!currentThread) return;

      let conversationHistory: Message[] = [...currentThread.messages, userMsg];
      const turnMessages: Message[] = [];

      let response = await generateResponse(conversationHistory);

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
            result = filtered.length > 0 ? filtered : 'Задач не найдено.';
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
            result = { status: 'success', task: newTask };
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
            return;
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
            result = { status: 'success' };
          } else if (name === 'delete_task') {
            const { id: taskId } = args;
            setTasks(prev => prev.filter(t => t.id !== taskId));
            db.deleteTask(taskId);
            result = { status: 'success' };
          } else if (name === 'save_as_note') {
            const { content, title } = args;
            const noteId = uuid();
            const savedNote: Thread = {
              id: noteId,
              title: (title || content.trim().slice(0, 40)) || 'Заметка',
              preview: content.trim().slice(0, 100),
              messages: [],
              createdAt: Date.now(),
              source: 'заметка' as const,
              is_meaningful: true,
              summary: content.trim(),
            };
            db.saveThread(savedNote);
            setThreads((prev: Thread[]) => [savedNote, ...(Array.isArray(prev) ? prev : [])]);
            const userId = db.getUserId();
            if (userId) {
              fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: content.trim() }], threadId: noteId, userId }),
              }).catch(() => {});
            }
            result = { status: 'success', noteId };
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: id,
            content: JSON.stringify(result),
            time: ft()
          });
        }

        turnMessages.push(...toolResults);

        conversationHistory = [
          ...conversationHistory,
          assistantToolCallMsg,
          ...toolResults
        ];

        response = await generateResponse(conversationHistory);
      }

      const assistantMsg: Message = { role: 'assistant', content: response.content || 'Готово!', time: ft(), sources: response.sources };
      if (isFirstMessage) generateTitle(text, assistantMsg.content);

      setThreads(prev => prev.map(t => {
        if (t.id === threadId) {
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
        errorMsg.content = 'Ошибка сети: Не удалось отправить запрос (возможно, заблокировано WebView или нет интернета).';
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

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    const finalText = replyQuote
      ? `[Ответ на: "${replyQuote.length > 100 ? replyQuote.slice(0, 100) + '...' : replyQuote}"]\n${text}`
      : text;
    setInput('');
    setReplyQuote(null);
    sendText(finalText);
  };

  useEffect(() => {
    if (autoSend && !autoSentRef.current && threadId) {
      autoSentRef.current = true;
      onAutoSentClear?.();
      sendText(autoSend);
    }
  }, [threadId]);

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

          const allAnswered = msg.planning_data.questions.every(q =>
            msg.planning_data?.answers?.[q.id] || q.id === questionId
          );

          if (allAnswered) {
            msg.planning_data.status = 'plan_generated';
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

      const prompt = `Пользователь ответил на уточняющие вопросы:\n\n${answersText}\n\nНа основе этих ответов составь пошаговый план действий (to-do list).\nОтвечай СТРОГО в формате JSON:\n{\n  "title": "Название плана",\n  "steps": ["шаг 1", "шаг 2", ...]\n}`;

      const response = await generateResponse([
        ...t.messages,
        { role: 'user', content: prompt, time: ft() }
      ], { tool_choice: 'none' });

      if (!response || !response.content) {
        throw new Error('AI вернул пустой ответ при генерации плана.');
      }

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
    const subtasks: SubTask[] = steps.map((s: string) => ({
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
        const updated = {
          ...t,
          messages: [...newMessages, {
            role: 'assistant' as const,
            content: 'Отлично! План добавлен в календарь. Ты найдешь его в списке задач со звездочкой.',
            time: ft()
          }]
        };
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
        const updated = {
          ...t,
          messages: [...newMessages, {
            role: 'assistant' as const,
            content: 'Хорошо, давай попробуем по-другому или просто продолжим общение.',
            time: ft()
          }]
        };
        db.saveThread(updated);
        return updated;
      }
      return t;
    }));
  };

  const generateTitle = async (userText: string, assistantText: string) => {
    try {
      const resp = await generateResponse(
        [{ role: 'user', content: `Придумай короткое название (3-5 слов, без кавычек) для чата, где пользователь написал:\n«${userText}»\nИИ ответил:\n«${assistantText.slice(0, 200)}»\nТолько название, без пояснений`, time: '' }],
        { tools: [], tool_choice: 'none' } as any
      );
      const title = resp?.content?.trim().replace(/^["«]|["»]$/g, '').slice(0, 60);
      if (!title || !threadId) return;
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => {
        if (t.id !== threadId) return t;
        const u = { ...t, title };
        db.saveThread(u);
        return u;
      }));
    } catch { /* не критично */ }
  };

  const handleClose = () => {
    // Fire-and-forget summarize if thread has enough content and no summary yet
    const userId = db.getUserId();
    if (userId && thread && !thread.summary) {
      const userMsgs = thread.messages.filter(m => m.role === 'user');
      if (userMsgs.length >= 2) {
        fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: thread.messages, threadId: thread.id, userId }),
        }).then(r => r.json()).then(({ summary }) => {
          if (summary) {
            setThreads((prev: Thread[]) => prev.map(t =>
              t.id === thread.id ? { ...t, summary, is_meaningful: true } : t
            ));
          }
        }).catch(() => {});
      }
    }
    onClose();
  };

  const saveMessageAsNote = (content: string) => {
    const noteId = uuid();
    const note: Thread = {
      id: noteId,
      title: content.trim().slice(0, 40) || 'Заметка',
      preview: content.trim().slice(0, 100),
      messages: [],
      createdAt: Date.now(),
      source: 'заметка' as const,
      is_meaningful: true,
      summary: content.trim(),
    };
    db.saveThread(note);
    setThreads((prev: Thread[]) => [note, ...(Array.isArray(prev) ? prev : [])]);
    const userId = db.getUserId();
    if (userId) {
      fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: content.trim() }], threadId: noteId, userId }),
      }).catch(() => {});
    }
  };

  const deleteMessage = (msg: Message) => {
    if (!threadId) return;
    setThreads((prev: Thread[]) => prev.map(t => {
      if (t.id !== threadId) return t;
      const newMessages = t.messages.filter(m => m !== msg);
      const updated = { ...t, messages: newMessages };
      db.saveThread(updated);
      return updated;
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

  const parseInline = (line: string, key: number): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      if (match[2]) parts.push(<strong key={match.index}>{match[2]}</strong>);
      else if (match[3]) parts.push(<em key={match.index}>{match[3]}</em>);
      else if (match[4]) parts.push(<code key={match.index} style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.07)', borderRadius: 4, padding: '1px 5px', fontSize: '0.9em' }}>{match[4]}</code>);
      last = match.index + match[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <React.Fragment key={key}>{parts}</React.Fragment>;
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
      const bulletMatch = line.match(/^[-•]\s+(.*)$/);
      if (numMatch || bulletMatch) {
        const items: React.ReactNode[] = [];
        while (i < lines.length) {
          const l = lines[i];
          const nm = l.match(/^(\d+)\.\s+(.*)$/);
          const bm = l.match(/^[-•]\s+(.*)$/);
          if (nm) { items.push(<li key={i}>{parseInline(nm[2], i)}</li>); i++; }
          else if (bm) { items.push(<li key={i}>{parseInline(bm[1], i)}</li>); i++; }
          else break;
        }
        nodes.push(numMatch
          ? <ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>{items}</ol>
          : <ul key={`ul-${i}`} style={{ paddingLeft: 20, margin: '6px 0', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: 3 }}>{items}</ul>
        );
      } else if (line === '') {
        nodes.push(<br key={i} />);
        i++;
      } else {
        nodes.push(<span key={i} style={{ display: 'block' }}>{parseInline(line, i)}</span>);
        i++;
      }
    }
    return <div>{nodes}</div>;
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#f0f0f0' }}>
      <div
        className="flex items-center justify-between px-5 flex-shrink-0"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', paddingBottom: '12px' }}
      >
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={handleClose}
          className="w-11 h-11 flex items-center justify-center"
        >
          <ChevronLeft size={24} strokeWidth={1.75} color="#222224" />
        </motion.button>

        <div className="flex items-center gap-0.5 rounded-full p-1" style={{ background: '#ffffff', position: 'relative' }}>
          <motion.div
            layoutId="aichat-tab-pill"
            style={{
              position: 'absolute',
              top: 4,
              width: 40, height: 40,
              borderRadius: '50%',
              background: 'rgba(34,34,36,0.08)',
              left: !noteMode ? 4 : 46,
              zIndex: 0,
            }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          />
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center"
            onClick={() => setNoteMode(false)}
            style={{ position: 'relative', zIndex: 1, background: 'transparent' }}
          >
            <MessageCircle size={20} strokeWidth={1.75} color={!noteMode ? '#222224' : 'rgba(34,34,36,0.3)'} />
          </button>
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center"
            onClick={() => setNoteMode(true)}
            style={{ position: 'relative', zIndex: 1, background: 'transparent' }}
          >
            <StickyNote size={20} strokeWidth={1.75} color={noteMode ? '#222224' : 'rgba(34,34,36,0.3)'} />
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

      {noteMode && threadId ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <NoteView threadId={threadId} threads={threads} setThreads={setThreads} tasks={tasks} onSwitchToChat={() => setNoteMode(false)} />
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-[20px_16px_8px] flex flex-col gap-3 scrollbar-hide min-h-0" style={{ display: noteMode ? 'none' : undefined }}>
        {(() => {
          const visibleMsgs = thread.messages.filter(m => m.role !== 'tool' && !m.tool_calls);
          if (visibleMsgs.length === 0) return (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <div className="text-[28px] font-extrabold text-center leading-[1.25]" style={{ color: '#222224' }}>
                Привет!<br />Есть мысли?
              </div>
              <div className="text-[15px] text-text-tertiary text-center">
                Поделись тем, что на уме
              </div>
            </div>
          );
          // Close dropdown on outside click
          const backdropEl = openMsgMenuIdx !== null ? (
            <div key="msg-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpenMsgMenuIdx(null)} />
          ) : null;

          const msgs = visibleMsgs.map((m, i) => {
            const isLast = i === visibleMsgs.length - 1;
            const showAnimated = isLast && m.role === 'assistant' && animatingContent !== null;
            const showActions = isTouchDevice || hoveredMsgIdx === i;
            return (
            <div key={i}
              onMouseEnter={() => m.role === 'assistant' && setHoveredMsgIdx(i)}
              onMouseLeave={() => setHoveredMsgIdx(null)}
              style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: m.role === 'user' ? '85%' : '100%',
              width: m.role === 'user' ? undefined : '100%',
            }}>
              <div style={m.role === 'user'
                ? { background: 'rgba(9,14,23,0.07)', borderRadius: 18, borderBottomRightRadius: 4, padding: '10px 14px', fontSize: 15, lineHeight: 1.5, color: '#222224', fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif" }
                : { fontSize: 15, lineHeight: 1.75, color: '#222224', fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif", width: '100%' }
              }>
                {m.role === 'user'
                  ? m.content
                  : showAnimated
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{animatingContent}</span>
                    : renderMarkdown(m.content)
                }

                {m.planning_data && (
                  <div className="mt-3 flex flex-col gap-3">
                    {m.planning_data.status === 'questionnaire' && (
                      <div className="flex flex-col gap-4">
                        {m.planning_data.questions.map((q) => {
                          const isAnswered = m.planning_data?.answers?.[q.id];
                          if (isAnswered) return (
                            <div key={q.id} className="bg-surface/80 p-2 rounded-lg text-[13px] text-text-primary border border-border">
                              <div className="text-text-tertiary text-[11px] mb-1">{q.question}</div>
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
                                    className="text-left p-2 bg-surface rounded-xl text-[13px] text-text-primary active:scale-95 transition-transform border border-border hover:bg-surface2 transition-colors"
                                  >
                                    {opt}
                                  </button>
                                ))}
                                <div className="relative">
                                  <input
                                    placeholder="Свой вариант..."
                                    className="w-full p-2 bg-surface rounded-xl text-[13px] text-text-primary border border-border outline-none focus:border-accent focus:bg-surface2 transition-colors"
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
                      <div className="bg-surface rounded-2xl p-4 shadow-sm border border-border flex flex-col gap-3 transition-colors">
                        <div className="text-[16px] font-bold text-accent flex items-center gap-2">
                          <Star size={18} fill="currentColor" />
                          {m.planning_data.plan.title}
                        </div>
                        <div className="flex flex-col gap-2">
                          {m.planning_data.plan.steps.map((step, sIdx) => (
                            <div key={sIdx} className="flex items-start gap-2 group">
                              <div className="w-5 h-5 rounded-full bg-accent/10 text-accent flex items-center justify-center text-[10px] font-bold mt-0.5 flex-shrink-0">
                                {sIdx + 1}
                              </div>
                              <input
                                value={step}
                                onChange={(e) => updatePlanStep(i, sIdx, e.target.value)}
                                className="flex-1 bg-transparent text-[13px] text-text-primary outline-none focus:text-accent"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleAcceptPlan(i)}
                            className="flex-1 h-10 bg-accent text-white rounded-xl text-[13px] font-bold active:scale-95 transition-transform"
                          >
                            Принять
                          </button>
                          <button
                            onClick={() => handleRejectPlan(i)}
                            className="flex-1 h-10 bg-surface2 text-text-primary rounded-xl text-[13px] font-bold active:scale-95 transition-transform"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && !showAnimated && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(34,34,36,0.07)' }}>
                    <div style={{ fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif", fontSize: 11, color: 'rgba(34,34,36,0.35)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                      Из архива
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {m.sources.map((s, si) => (
                        <span key={si} style={{
                          fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
                          fontSize: 12, color: 'rgba(34,34,36,0.5)',
                          background: 'rgba(34,34,36,0.06)', borderRadius: 6,
                          padding: '3px 8px',
                        }}>
                          {s.title}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-text-tertiary px-1">{m.time}</div>

              {/* Action panel — assistant messages only */}
              {m.role === 'assistant' && !showAnimated && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', marginTop: 2,
                  opacity: showActions ? 1 : 0,
                  transition: 'opacity 0.15s',
                  position: 'relative',
                }}>
                  <button
                    onClick={() => navigator.clipboard?.writeText(m.content)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#bbb', display: 'flex', alignItems: 'center', transition: 'color 0.12s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#555')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
                  >
                    <Copy size={14} strokeWidth={1.5} />
                  </button>

                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenMsgMenuIdx(openMsgMenuIdx === i ? null : i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#bbb', display: 'flex', alignItems: 'center', transition: 'color 0.12s' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#555')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#bbb')}
                    >
                      <MoreHorizontal size={14} strokeWidth={1.5} />
                    </button>

                    <AnimatePresence>
                      {openMsgMenuIdx === i && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.12 }}
                          style={{
                            position: 'absolute', right: 0, bottom: '100%', marginBottom: 4,
                            background: '#fff', border: '1px solid #ebebeb',
                            borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                            padding: '4px 0', zIndex: 20, minWidth: 160,
                          }}
                        >
                          {[
                            { label: 'Сохранить как заметку', color: '#222', action: () => { saveMessageAsNote(m.content); setOpenMsgMenuIdx(null); } },
                            { label: 'Ответить', color: '#222', action: () => { setReplyQuote(m.content); setOpenMsgMenuIdx(null); inputRef.current?.focus(); } },
                            { label: 'Удалить', color: '#e53e3e', action: () => { deleteMessage(m); setOpenMsgMenuIdx(null); } },
                          ].map(item => (
                            <button key={item.label}
                              onClick={item.action}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '8px 14px', fontSize: 13, color: item.color,
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                            >
                              {item.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
            );
          });
          return [backdropEl, ...msgs];
        })()}

        {isTyping && (
          <div style={{ alignSelf: 'flex-start', paddingLeft: 2, paddingBottom: 4 }}>
            <span style={{
              fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
              fontSize: 14, color: 'rgba(34,34,36,0.4)', fontStyle: 'italic',
            }}>
              {THINKING_PHRASES[thinkingIdx]}
            </span>
          </div>
        )}
      </div>

      <div
        className="px-4 flex-shrink-0"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}
      >
        <AnimatePresence>
          {replyQuote && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.12 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#f5f5f5', borderRadius: 6, padding: '8px 12px',
                marginBottom: 6, borderLeft: '2px solid #aaa',
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: '#888', fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyQuote.length > 100 ? replyQuote.slice(0, 100) + '...' : replyQuote}
              </span>
              <button onClick={() => setReplyQuote(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <X size={14} strokeWidth={1.5} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="rounded-[20px] p-4" style={{ background: '#ffffff' }}>
          <textarea
            ref={inputRef}
            rows={1}
            className="w-full bg-transparent outline-none"
            style={{
              fontFamily: "'Muller', 'Helvetica Neue', Helvetica, sans-serif",
              fontSize: '15px',
              color: '#222224',
              resize: 'none',
              lineHeight: 1.55,
              border: 'none',
              display: 'block',
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
            <div className="flex items-center gap-2">
              <motion.button
                onPointerDown={e => { e.preventDefault(); startRecording(); }}
                onPointerUp={e => { e.preventDefault(); stopRecording(); }}
                onPointerCancel={stopRecording}
                style={{
                  width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: voiceState === 'recording' ? '#c0392b' : voiceState === 'processing' ? 'rgba(34,34,36,0.15)' : 'rgba(34,34,36,0.08)',
                  transition: 'background 0.15s',
                }}
              >
                {voiceState === 'processing'
                  ? <Loader size={15} strokeWidth={2} color="#222224" className="animate-spin" />
                  : <Mic size={15} strokeWidth={1.75} color={voiceState === 'recording' ? '#fff' : 'rgba(34,34,36,0.5)'} />
                }
              </motion.button>
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
    </div>
  );
}
