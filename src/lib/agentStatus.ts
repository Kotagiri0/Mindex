import { Task } from '../types';

export type AgentGlobalState = 'ok' | 'working' | 'needs';

/**
 * Выводит глобальное состояние агента из задач.
 * Приоритет: если хоть одна задача ждёт пользователя ('needs') — состояние 'needs'
 * (это всегда важнее). Иначе если есть выполняемые ('working') — 'working'.
 * Иначе — 'ok'. workingCount — сколько задач агент сейчас ведёт (working).
 */
export function deriveAgentStatus(tasks: Task[]): { state: AgentGlobalState; workingCount: number } {
  const list = Array.isArray(tasks) ? tasks : [];
  const working = list.filter(t => t.agent === 'working').length;
  const needs = list.some(t => t.agent === 'needs');
  if (needs) return { state: 'needs', workingCount: working };
  if (working > 0) return { state: 'working', workingCount: working };
  return { state: 'ok', workingCount: 0 };
}
