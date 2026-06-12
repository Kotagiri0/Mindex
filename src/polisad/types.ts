// ПОЛИСАД — система персональной памяти для AI-агентов.
// Общие типы модуля. Модуль не знает про express и telegram —
// все внешние зависимости (БД, ключи, LLM-вызов) передаются явно.

import type { Pool } from 'pg';

export interface PolisadMessage {
  role: 'user' | 'assistant' | 'tool' | string;
  content: string;
  time?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ArchiveRow {
  title: string;
  summary: string;
}

export interface ArchiveResult {
  rows: ArchiveRow[];
  // true только при реальном совпадении (vector или keyword hit), не при recent-fallback.
  // Источники показываются пользователю только при explicit-совпадении.
  isExplicit: boolean;
}

export interface RetrieveOptions {
  // pgvector доступен и можно пробовать векторный поиск
  vectorEnabled: boolean;
  // исключить дневные треды бота ("Telegram Bot YYYY-MM-DD") —
  // они идут отдельным блоком «Вчера в боте», не через RAG
  excludeBotThreads?: boolean;
}

export interface SummarizeResult {
  summary: string;
  isMeaningful: boolean;
}

// LLM-вызов в формате chat/completions, возвращающий fetch Response.
// Передаётся снаружи, чтобы модуль использовал существующий
// callRouterAI с его ретраями и OpenRouter-fallback.
export type ChatCall = (body: object) => Promise<Response>;

export type Db = Pool;
