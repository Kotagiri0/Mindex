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
  logRetrieval,
  recordCoRetrieval,
  jaccard,
  ACTIVATION_DECAY,
  SIM_WEIGHT,
} from './activation.ts';
export { stemRu, extractKeywords } from './morphology.ts';
export { getProfileSummaries, retrieveArchive } from './retrieve.ts';
export { createPolisadApi } from './api.ts';
export type { PolisadApiDeps } from './api.ts';
export {
  summarizeThreadCore,
  sweepColdThreads,
  summarizeBotThread,
  SWEEP_INTERVAL_MS,
} from './summarize.ts';
export { scoreMeaningful } from './meaningful.ts';
export type { MeaningfulVerdict } from './meaningful.ts';
export {
  BOT_THREAD_TITLE,
  CONTEXT_WINDOW,
  botThreadTitle,
  foldOverflowMessages,
  getYesterdaySummary,
} from './temporal.ts';
