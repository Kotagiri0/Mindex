// ПОЛИСАД — многослойная система персональной памяти для AI-агентов.
//
// Слой 1: профиль пользователя — всегда в промпте (getProfileSummaries)
// Слой 2: семантическая память / RAG — каскад vector → keyword → recent (retrieveArchive)
// Слой 3: временная память — дневной цикл бота (foldOverflowMessages, getYesterdaySummary)
// Создание памяти: саммаризация (summarizeThreadCore, sweepColdThreads, summarizeBotThread)
//
// Принцип: retrieval без LLM. LLM используется только при создании summary.

export type {
  PolisadMessage,
  ArchiveRow,
  ArchiveResult,
  RetrieveOptions,
  SummarizeResult,
  ChatCall,
} from './types.ts';

export { generateEmbedding } from './embeddings.ts';
export {
  ensurePolisadSchema,
  activationScore,
  logAccess,
  ACTIVATION_DECAY,
  SIM_WEIGHT,
} from './activation.ts';
export { getProfileSummaries, retrieveArchive } from './retrieve.ts';
export {
  summarizeThreadCore,
  sweepColdThreads,
  summarizeBotThread,
  SWEEP_INTERVAL_MS,
} from './summarize.ts';
export {
  BOT_THREAD_TITLE,
  CONTEXT_WINDOW,
  botThreadTitle,
  foldOverflowMessages,
  getYesterdaySummary,
} from './temporal.ts';
