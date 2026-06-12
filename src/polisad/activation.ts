// ПОЛИСАД: активационная модель памяти (по мотивам ACT-R, Anderson).
//
// Идея: релевантность воспоминания — это не только семантическая близость.
// Память, к которой обращались часто и недавно, должна вспоминаться легче,
// заброшенная — тонуть. Это чистая математика, ноль LLM:
//
//   activation = SIM_WEIGHT * similarity + ln(1 + Σ tᵢ^(-DECAY))
//
//   tᵢ     — дни с i-го обращения к треду (минимум 1 час, чтобы свежий
//            лог не давал взрывного буста)
//   DECAY  — скорость забывания (0.5 — классическое значение ACT-R)
//
// Каждый инжект треда в промпт (explicit-совпадение) логируется как
// «обращение» — память укрепляется от использования.

import type { Db } from './types.ts';

export const ACTIVATION_DECAY = 0.5;     // d в ACT-R; тюнится по логам
export const SIM_WEIGHT = 10;            // вес семантики против истории обращений
export const ACTIVATION_MAX_BOOST = 2.5; // потолок буста: история ломает ничью,
                                         // но не перебивает явную семантику
                                         // (2.5 ≈ разница в 0.25 similarity)

// SQL-фрагмент: масса обращений Σ t^(-d) для треда t (alias таблицы тредов).
// EXTRACT(EPOCH ...)/86400 — возраст обращения в днях, минимум 1/24 (час).
export const ACCESS_MASS_SQL = `
  COALESCE((
    SELECT SUM(POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - al.ts)) / 86400.0, 0.0417), -${ACTIVATION_DECAY}))
    FROM polisad_access_log al
    WHERE al.thread_id = t.id
  ), 0)`;

export function activationScore(similarity: number, accessMass: number): number {
  const boost = Math.min(Math.log(1 + Math.max(0, accessMass)), ACTIVATION_MAX_BOOST);
  return SIM_WEIGHT * similarity + boost;
}

// Журнал обращений: fire-and-forget, ошибка не должна ронять retrieval.
export function logAccess(db: Db, userId: string, threadIds: string[]): void {
  if (threadIds.length === 0) return;
  const values = threadIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  db.query(
    `INSERT INTO polisad_access_log (user_id, thread_id) VALUES ${values}`,
    [userId, ...threadIds]
  ).catch((e: any) => console.warn('[polisad/activation] logAccess failed:', e?.message));
}

// Схема журналов. Additive, вызывается с обоих серверов при старте.
export async function ensurePolisadSchema(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS polisad_access_log (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      thread_id UUID NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polisad_access_thread ON polisad_access_log (thread_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polisad_access_user_ts ON polisad_access_log (user_id, ts)`);
  // Журнал retrieval: одна строка на каждый вызов retrieveArchive.
  // Источник метрик: hit rate по ярусам, распределение similarity
  // (проверка порога 0.65), латентность.
  await db.query(`
    CREATE TABLE IF NOT EXISTS polisad_retrieval_log (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      tier TEXT NOT NULL,              -- 'vector' | 'keyword' | 'recent' | 'none'
      query_len INT NOT NULL,
      results_count INT NOT NULL,
      top_similarity REAL,             -- только для tier='vector'
      latency_ms INT NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polisad_retrieval_ts ON polisad_retrieval_log (ts)`);
}

// Лог retrieval: fire-and-forget, ошибка не роняет основной поток.
export function logRetrieval(
  db: Db,
  userId: string,
  data: { tier: string; queryLen: number; resultsCount: number; topSimilarity: number | null; latencyMs: number }
): void {
  db.query(
    `INSERT INTO polisad_retrieval_log (user_id, tier, query_len, results_count, top_similarity, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, data.tier, data.queryLen, data.resultsCount, data.topSimilarity, data.latencyMs]
  ).catch((e: any) => console.warn('[polisad/metrics] logRetrieval failed:', e?.message));
}
