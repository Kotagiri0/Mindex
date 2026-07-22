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

// Spreading activation (ассоциативная активация ACT-R): треды, связанные
// с недавно вспоминавшимися, получают дополнительный буст. Связи строятся
// из поведения (со-вспоминание), не из LLM-экстракции сущностей.
export const ASSOC_MAX_BOOST = 1.5;      // ассоциации слабее прямой истории обращений
export const ASSOC_RECENT_HOURS = 24;    // «текущий контекст» = вспомненное за сутки

// SQL-фрагмент: ассоциативная масса треда t — суммарный вес рёбер к тредам,
// которые этот пользователь вспоминал за последние ASSOC_RECENT_HOURS часов.
export const ASSOC_MASS_SQL = `
  COALESCE((
    SELECT SUM(e.weight)
    FROM polisad_memory_edges e
    WHERE (e.thread_a = t.id OR e.thread_b = t.id)
      AND (CASE WHEN e.thread_a = t.id THEN e.thread_b ELSE e.thread_a END) IN (
        SELECT DISTINCT al.thread_id FROM polisad_access_log al
        WHERE al.user_id = t.user_id AND al.ts > NOW() - INTERVAL '${ASSOC_RECENT_HOURS} hours'
      )
  ), 0)`;

// ── Base-level activation: устаревание факта (по ACT-R, base-level learning) ──
//
// activationScore выше — про релевантность треда ЗАПРОСУ (similarity + история).
// Здесь другое: насколько факт вообще «жив» сам по себе, безотносительно запроса.
// Нужно для слоя профиля, который инжектится БЕЗУСЛОВНО — отсюда «бородатые
// факты о тебе», которые ассистент пихает в сообщение, хотя им год.
//
//   B = ln( age^(-d) + Σ tᵢ^(-d) )
//
//   age   — возраст факта в днях (первое «обращение» — само создание)
//   Σ tᵢ  — масса повторных обращений (тема всплывала → факт подкреплён)
//   d     — тот же DECAY забывания
//
// Свежий факт: age мал → age^(-d) велик → B высокая.
// Старый и ни разу не подкреплённый: age^(-d) → 0 → B уходит в минус.
// Старый, но подкреплённый (тема всплывала): Σ tᵢ спасает → B держится.
//
// Факт с B ниже PROFILE_STALE_THRESHOLD — кандидат «промолчать»: семантически
// он, может, и подходит, но давно не подтверждался, поэтому навязывать его не надо.
export const BASE_LEVEL_DECAY = ACTIVATION_DECAY;

// Порог тишины. При d=0.5 и нуле подкреплений факт уходит под порог примерно
// после трёх недель забвения: -0.5·ln(21) ≈ -1.52. Одно недавнее всплытие темы
// поднимает массу обращений до ~1 → B ≈ 0 → факт снова «жив».
export const PROFILE_STALE_THRESHOLD = -1.5;

// Минимальный возраст — час, чтобы только что записанный факт не давал ∞.
const MIN_AGE_DAYS = 0.0417;

export function baseLevelActivation(ageDays: number, accessMass = 0): number {
  const age = Math.max(ageDays, MIN_AGE_DAYS);
  const creationTerm = Math.pow(age, -BASE_LEVEL_DECAY);
  return Math.log(creationTerm + Math.max(0, accessMass));
}

// Удобный предикат: стоит ли факт навязывать (true) или лучше промолчать (false).
export function isFactStillFresh(ageDays: number, accessMass = 0): boolean {
  return baseLevelActivation(ageDays, accessMass) >= PROFILE_STALE_THRESHOLD;
}

export function activationScore(similarity: number, accessMass: number, assocMass = 0): number {
  const accessBoost = Math.min(Math.log(1 + Math.max(0, accessMass)), ACTIVATION_MAX_BOOST);
  const assocBoost = Math.min(Math.log(1 + Math.max(0, assocMass)), ASSOC_MAX_BOOST);
  // Инвариант: весь несемантический буст вместе ≤ ACTIVATION_MAX_BOOST —
  // история и ассоциации компенсируют максимум 0.25 similarity,
  // явное семантическое совпадение перебить нельзя
  return SIM_WEIGHT * similarity + Math.min(accessBoost + assocBoost, ACTIVATION_MAX_BOOST);
}

// Со-вспоминание: треды, извлечённые вместе, связываются ребром (вес растёт).
// Fire-and-forget. Пары нормализованы (a < b), чтобы ребро было одно.
export function recordCoRetrieval(db: Db, userId: string, threadIds: string[]): void {
  if (threadIds.length < 2) return;
  const pairs: [string, string][] = [];
  for (let i = 0; i < threadIds.length; i++) {
    for (let j = i + 1; j < threadIds.length; j++) {
      const [a, b] = [threadIds[i], threadIds[j]].sort();
      pairs.push([a, b]);
    }
  }
  for (const [a, b] of pairs) {
    db.query(
      `INSERT INTO polisad_memory_edges (user_id, thread_a, thread_b, weight, updated_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (thread_a, thread_b)
       DO UPDATE SET weight = polisad_memory_edges.weight + 1, updated_at = NOW()`,
      [userId, a, b]
    ).catch((e: any) => console.warn('[polisad/activation] recordCoRetrieval failed:', e?.message));
  }
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
// ВАЖНО: user_threads.id и user_id — TEXT (см. server.ts), поэтому thread_id и
// thread_a/thread_b здесь тоже TEXT. Иначе джойн al.thread_id = t.id даёт
// «operator does not exist: uuid = text» и весь векторный ярус падает в keyword.
export async function ensurePolisadSchema(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS polisad_access_log (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
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
  // Граф со-вспоминания: ребро между тредами, извлечёнными вместе.
  // Источник ассоциативной активации (spreading activation).
  await db.query(`
    CREATE TABLE IF NOT EXISTS polisad_memory_edges (
      thread_a TEXT NOT NULL,
      thread_b TEXT NOT NULL,
      user_id TEXT NOT NULL,
      weight INT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (thread_a, thread_b)
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_polisad_edges_b ON polisad_memory_edges (thread_b)`);
  // Поля детектора повторных запросов (фундамент feedback loop)
  await db.query(`ALTER TABLE polisad_retrieval_log ADD COLUMN IF NOT EXISTS keywords TEXT`);
  await db.query(`ALTER TABLE polisad_retrieval_log ADD COLUMN IF NOT EXISTS repeated_query BOOLEAN`);

  // Перезапись фактов: когда новая информация отменяет старый факт о пользователе
  // («уволился из X» отменяет «работает в X»), старый тред помечается superseded —
  // и навсегда выпадает из профиля и RAG. Additive, данные не трогаем.
  // superseded_by — id треда, чья информация отменила этот факт (для аудита).
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE user_threads ADD COLUMN IF NOT EXISTS superseded_by TEXT`);

  // Миграция типов для таблиц, созданных ранее с UUID-колонками (прод).
  // ALTER COLUMN TYPE только если колонка ещё uuid — иначе no-op без перезаписи.
  await db.query(`DO $$
    BEGIN
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'polisad_access_log' AND column_name = 'thread_id') = 'uuid' THEN
        ALTER TABLE polisad_access_log ALTER COLUMN thread_id TYPE TEXT USING thread_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'polisad_memory_edges' AND column_name = 'thread_a') = 'uuid' THEN
        ALTER TABLE polisad_memory_edges ALTER COLUMN thread_a TYPE TEXT USING thread_a::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'polisad_memory_edges' AND column_name = 'thread_b') = 'uuid' THEN
        ALTER TABLE polisad_memory_edges ALTER COLUMN thread_b TYPE TEXT USING thread_b::text;
      END IF;
    END $$;`);
}

// Детектор повторного запроса: пользователь спрашивает почти то же самое
// в течение получаса — вероятный промах памяти (бот не вспомнил → переспросили).
// Jaccard-сходство множеств ключевых слов, чистая математика.
export const REPEAT_WINDOW_MINUTES = 30;
export const REPEAT_JACCARD_THRESHOLD = 0.5;

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// Лог retrieval: fire-and-forget, ошибка не роняет основной поток.
// Перед записью сравнивает ключевые слова с предыдущим запросом пользователя —
// помечает повторы (repeated_query) как сигнал промаха памяти.
export function logRetrieval(
  db: Db,
  userId: string,
  data: { tier: string; queryLen: number; resultsCount: number; topSimilarity: number | null; latencyMs: number; keywords?: string[] }
): void {
  const kw = data.keywords ?? [];
  (async () => {
    let repeated: boolean | null = null;
    if (kw.length > 0) {
      const prev = await db.query(
        `SELECT keywords FROM polisad_retrieval_log
         WHERE user_id = $1 AND keywords IS NOT NULL
           AND ts > NOW() - INTERVAL '${REPEAT_WINDOW_MINUTES} minutes'
         ORDER BY ts DESC LIMIT 1`,
        [userId]
      );
      const prevKw = prev.rows[0]?.keywords ? String(prev.rows[0].keywords).split(' ') : [];
      repeated = prevKw.length > 0 ? jaccard(kw, prevKw) >= REPEAT_JACCARD_THRESHOLD : false;
    }
    await db.query(
      `INSERT INTO polisad_retrieval_log (user_id, tier, query_len, results_count, top_similarity, latency_ms, keywords, repeated_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, data.tier, data.queryLen, data.resultsCount, data.topSimilarity, data.latencyMs, kw.length > 0 ? kw.join(' ') : null, repeated]
    );
  })().catch((e: any) => console.warn('[polisad/metrics] logRetrieval failed:', e?.message));
}
