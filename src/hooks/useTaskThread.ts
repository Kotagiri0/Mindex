import { useCallback, useState } from 'react';
import { Task, Thread, Message } from '../types';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { runAgentTurn, koraEnabled } from '../lib/kora-client';
import { generateResponse } from '../lib/groq';
import type { GraphNode } from '../kora/graph';

const fmt2 = (n: number) => n.toString().padStart(2, '0');
const nowTime = () => {
  const d = new Date();
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
};

interface UseTaskThreadArgs {
  task: Task | null;
  threads: Thread[];
  setThreads: (next: Thread[] | ((prev: Thread[]) => Thread[])) => void;
  setTasks: (next: Task[] | ((prev: Task[]) => Task[])) => void;
}

/**
 * Логика треда конкретной задачи ("Обсудить с Мыслью" внутри панели/sheet задачи).
 * Тред — обычный Thread с id = task.threadId (заводится лениво при первом
 * сообщении). Общий хук для десктопа (TaskDetailPanel) и мобилки (EditTaskModal),
 * чтобы поведение не расходилось между поверхностями (правило синхронизации из
 * CLAUDE.md) — один источник истины вместо двух копипаст.
 */
export function useTaskThread({ task, threads, setThreads, setTasks }: UseTaskThreadArgs) {
  const [busy, setBusy] = useState(false);
  const [liveGraph, setLiveGraph] = useState<GraphNode[] | null>(null);

  const thread = (task?.threadId && threads.find(t => t.id === task.threadId)) || null;

  // Достаёт существующий тред задачи или заводит новый — id сразу пишем в task.threadId.
  const ensureThread = useCallback(async (): Promise<Thread> => {
    if (task?.threadId) {
      const existing = threads.find(t => t.id === task.threadId);
      if (existing) return existing;
    }
    const id = task?.threadId || uuid();
    const created: Thread = {
      id,
      title: task?.name || 'Задача',
      preview: '',
      messages: [],
      createdAt: Date.now(),
      source: 'мысль',
    };
    setThreads(prev => [...(Array.isArray(prev) ? prev : []), created]);
    await db.saveThread(created);
    if (task && task.threadId !== id) {
      const updatedTask: Task = { ...task, threadId: id };
      setTasks(prev => (Array.isArray(prev) ? prev : []).map(t => (t.id === task.id ? updatedTask : t)));
      await db.saveTask(updatedTask);
    }
    return created;
  }, [task, threads, setThreads, setTasks]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!task || !trimmed || busy) return;
    setBusy(true);
    setLiveGraph(null);

    const th = await ensureThread();
    const userMsg: Message = { role: 'user', content: trimmed, time: nowTime() };
    let current: Thread = { ...th, messages: [...th.messages, userMsg], preview: trimmed.slice(0, 60) };
    setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => (t.id === current.id ? current : t)));
    await db.saveThread(current);

    try {
      if (koraEnabled()) {
        const history = current.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-20)
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        const result = await runAgentTurn({
          threadId: current.id,
          message: trimmed,
          history,
          onGraph: setLiveGraph,
        });
        const finalMsg: Message = { role: 'assistant', content: result.answer || 'Готово!', time: nowTime(), graph: result.graph };
        current = { ...current, messages: [...current.messages, finalMsg] };
      } else {
        // Без tool-цикла — простой вызов ответа в контексте треда задачи (как ChatView, но no_tools).
        const response = await generateResponse(current.messages, { no_tools: true });
        const finalMsg: Message = { role: 'assistant', content: response.content || 'Готово!', time: nowTime() };
        current = { ...current, messages: [...current.messages, finalMsg] };
      }
    } catch (err: any) {
      const errMsg: Message = { role: 'assistant', content: `Ошибка: ${err?.message || 'не получилось связаться с Мыслью'}`, time: nowTime() };
      current = { ...current, messages: [...current.messages, errMsg] };
    } finally {
      setThreads(prev => (Array.isArray(prev) ? prev : []).map(t => (t.id === current.id ? current : t)));
      await db.saveThread(current);
      setBusy(false);
      setLiveGraph(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, busy, ensureThread, setThreads]);

  return { thread, busy, liveGraph, sendMessage };
}
