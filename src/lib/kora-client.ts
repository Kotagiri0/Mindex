// SSE-клиент для агентного endpoint-а КОРА (Фаза 9B).
// EventSource не умеет POST, поэтому парсим поток вручную: fetch с
// ReadableStream, разбивка по "\n\n" на события SSE, внутри — строки
// "event:" и "data:". Авторизация — как в apiFetch (src/lib/auth.ts):
// Bearer-токен из storage.
//
// Временный флаг koraEnabled() — до валидации нового пути на реальных
// сценариях. Пока включается вручную через localStorage, потом станет
// дефолтом и флаг уйдёт.

import { storage } from './storage';
import type { GraphNode } from '../kora/graph';

export interface KoraTurnResult {
  answer: string;
  stopReason: string;
  graph: GraphNode[];
}

export interface RunAgentTurnOptions {
  threadId: string;
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  onGraph: (nodes: GraphNode[]) => void;
  signal?: AbortSignal;
}

/** Временный опт-ин флаг: 'kora' в localStorage === '1' включает новый агентный путь. */
export const koraEnabled = (): boolean => {
  try {
    return localStorage.getItem('kora') === '1';
  } catch {
    return false;
  }
};

/**
 * Отправляет ход в /api/agent/turn и парсит SSE-поток.
 * onGraph зовётся на каждый снимок узлов (event: graph).
 * Резолвится финальным { answer, stopReason, graph } (event: final).
 * Реджектится на event: error или сетевой ошибке.
 */
export const runAgentTurn = async (opts: RunAgentTurnOptions): Promise<KoraTurnResult> => {
  const { threadId, message, history, onGraph, signal } = opts;
  const token = storage.getSessionToken();

  const res = await fetch(`${window.location.origin}/api/agent/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ threadId, message, history }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Агентный endpoint вернул ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseEvent = (raw: string): { event: string; data: string } | null => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    if (dataLines.length === 0) return null;
    return { event, data: dataLines.join('\n') };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const parsed = parseEvent(rawEvent);
      if (!parsed) continue;

      if (parsed.event === 'graph') {
        try {
          onGraph(JSON.parse(parsed.data) as GraphNode[]);
        } catch {
          // некорректный снимок — пропускаем, поток продолжается
        }
      } else if (parsed.event === 'final') {
        const final = JSON.parse(parsed.data) as KoraTurnResult;
        return final;
      } else if (parsed.event === 'error') {
        const errData = JSON.parse(parsed.data) as { error: string };
        throw new Error(errData.error || 'Ошибка агента');
      }
    }
  }

  throw new Error('Поток агента завершился без финального ответа.');
};
