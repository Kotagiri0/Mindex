// ПОЛИСАД: retrieval — слой 1 (профиль) и слой 2 (семантическая память / RAG).
// Каскад: vector → keyword → recent. Ноль LLM-токенов на retrieval.
//
// Векторный ярус ранжируется активационной моделью (activation.ts):
// кандидаты отбираются по similarity, итоговый порядок учитывает,
// как часто и давно тред вспоминался. Каждый explicit-инжект логируется —
// память укрепляется от использования.

import type { ArchiveResult, Db, RetrieveOptions } from './types.ts';
import { generateEmbedding } from './embeddings.ts';
import { BOT_THREAD_TITLE } from './temporal.ts';
import { ACCESS_MASS_SQL, ASSOC_MASS_SQL, activationScore, baseLevelActivation, isFactStillFresh, logAccess, logRetrieval, recordCoRetrieval } from './activation.ts';
import { extractKeywords } from './morphology.ts';

// MMR-дедупликация: почти одинаковые воспоминания (30 дневных тредов про один
// проект) не должны занимать всю выдачу — место отдаётся разнообразию.
const DEDUP_SIMILARITY = 0.92;

// Реплики короче этого порога («ок», «да», «спс», «ясно») не несут запроса к
// памяти — пропускаем дорогой embedding-вызов и идём сразу в keyword/recent.
// Экономит сетевой round-trip к провайдеру эмбеддингов на каждом таком сообщении.
const MIN_VECTOR_QUERY_CHARS = 6;

// Слой 1: профильные треды — идентичность пользователя в промпте.
//
// Раньше: первые 3 профильных треда инжектились безусловно — отсюда «бородатые
// факты», которые ассистент пихает в сообщение, хотя им год.
// Теперь: каждый факт проходит проверку на свежесть (base-level activation, ACT-R).
// Подтверждённый или недавний факт остаётся; старый и ни разу не всплывавший —
// «промолчать», выпадает. Перезаписанные (superseded) факты исключаются на уровне SQL.
// Инвариант: хотя бы один факт идентичности всегда остаётся (самый живой),
// чтобы агент не потерял, кто перед ним.
export async function getProfileSummaries(db: Db, userId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT t.summary,
            EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 86400.0 AS age_days,
            ${ACCESS_MASS_SQL} AS access_mass
     FROM user_threads t
     WHERE t.user_id = $1
       AND t.summary IS NOT NULL
       AND t.is_meaningful IS NOT FALSE
       AND t.superseded_at IS NULL
       AND (
         t.title = 'О себе'
         OR t.label = 'profile'
         OR (t.source = 'заметка' AND t.title ILIKE '%себ%')
       )
     ORDER BY t.created_at ASC
     LIMIT 5`,
    [userId]
  );
  if (rows.length === 0) return [];

  // Считаем base-level активацию каждого факта; ранжируем по свежести.
  const scored = rows.map((r: any) => ({
    summary: r.summary as string,
    age: Number(r.age_days),
    score: baseLevelActivation(Number(r.age_days), Number(r.access_mass)),
    fresh: isFactStillFresh(Number(r.age_days), Number(r.access_mass)),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Свежие факты (до 3). Если все «остыли» — оставляем один самый живой,
  // чтобы агент не остался без идентичности.
  const fresh = scored.filter(s => s.fresh).slice(0, 3);
  const picked = fresh.length > 0 ? fresh : scored.slice(0, 1);
  return picked.map(s => s.summary);
}

// Дедуп выдачи: жадный проход по отсортированным кандидатам, пропускаем тех,
// кто слишком похож (cosine > DEDUP_SIMILARITY) на уже выбранного.
async function dedupCandidates(db: Db, sorted: any[], limit: number): Promise<any[]> {
  if (sorted.length <= 1) return sorted.slice(0, limit);
  const ids = sorted.map((r: any) => r.id);
  let pairSim = new Map<string, number>();
  try {
    const { rows } = await db.query(
      `SELECT a.id AS id_a, b.id AS id_b, 1 - (a.embedding <=> b.embedding) AS sim
       FROM user_threads a
       JOIN user_threads b ON a.id < b.id
       WHERE a.id = ANY($1::text[]) AND b.id = ANY($1::text[])
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL`,
      [ids]
    );
    for (const r of rows) {
      pairSim.set(`${r.id_a}|${r.id_b}`, Number(r.sim));
      pairSim.set(`${r.id_b}|${r.id_a}`, Number(r.sim));
    }
  } catch (e: any) {
    console.warn('[polisad/retrieve] dedup failed, keeping order:', e?.message);
    return sorted.slice(0, limit);
  }
  const picked: any[] = [];
  for (const cand of sorted) {
    if (picked.length >= limit) break;
    const isDuplicate = picked.some(p => (pairSim.get(`${p.id}|${cand.id}`) ?? 0) > DEDUP_SIMILARITY);
    if (!isDuplicate) picked.push(cand);
  }
  // если дедуп выкинул всех кроме одного — добираем дублями до лимита не нужно:
  // лучше 1-2 разнообразных воспоминания, чем 3 одинаковых
  return picked;
}

// Слой 2: каскадный поиск по архиву.
export async function retrieveArchive(
  db: Db,
  userId: string,
  queryText: string,
  apiKey: string | undefined,
  opts: RetrieveOptions
): Promise<ArchiveResult> {
  // Дневные треды бота исключаются по запросу вызывающего —
  // у бота они идут отдельным блоком «Вчера в боте»
  const botThreadFilter = opts.excludeBotThreads
    ? `AND t.title NOT LIKE '${BOT_THREAD_TITLE} %'`
    : '';
  const baseFilter = `
    AND t.summary IS NOT NULL
    AND t.is_meaningful IS NOT FALSE
    AND t.superseded_at IS NULL
    AND t.label IS DISTINCT FROM 'skill:self_knowledge'
    AND t.title IS DISTINCT FROM 'О себе'
    ${botThreadFilter}
  `;

  let rows: any[] = [];
  let isExplicit = false;
  let tier: 'vector' | 'keyword' | 'recent' | 'none' = 'none';
  let topSimilarity: number | null = null;
  const startedAt = Date.now();

  // 1. Vector search: кандидаты по similarity (порог 0.65, до 10 штук),
  //    итоговый топ-3 — по активации (similarity + история обращений).
  //    Слишком короткие реплики не эмбеддим — экономим сетевой вызов.
  if (opts.vectorEnabled && queryText.trim().length >= MIN_VECTOR_QUERY_CHARS) {
    try {
      const queryEmbedding = await generateEmbedding(queryText, apiKey);
      if (queryEmbedding) {
        const res = await db.query(
          `SELECT t.id, t.title, t.summary,
                  1 - (t.embedding <=> $2::vector) AS similarity,
                  ${ACCESS_MASS_SQL} AS access_mass,
                  ${ASSOC_MASS_SQL} AS assoc_mass
           FROM user_threads t
           WHERE t.user_id = $1
             AND t.embedding IS NOT NULL
             ${baseFilter}
             AND 1 - (t.embedding <=> $2::vector) > 0.65
           ORDER BY t.embedding <=> $2::vector
           LIMIT 10`,
          [userId, `[${queryEmbedding.join(',')}]`]
        );
        if (res.rows.length > 0) {
          const sorted = res.rows
            .map((r: any) => ({ ...r, _score: activationScore(Number(r.similarity), Number(r.access_mass), Number(r.assoc_mass)) }))
            .sort((a: any, b: any) => b._score - a._score);
          rows = await dedupCandidates(db, sorted, 3);
          isExplicit = true;
          tier = 'vector';
          topSimilarity = Math.max(...res.rows.map((r: any) => Number(r.similarity)));
        }
      }
    } catch (e: any) {
      // vector miss из-за ошибки → деградируем в keyword, не падаем
      console.warn('[polisad/retrieve] vector search failed:', e?.message);
    }
  }

  // 2. Keyword fallback
  if (rows.length === 0) {
    const keywords = extractKeywords(queryText);
    if (keywords.length > 0) {
      const conditions = keywords.map((_: string, i: number) => `(t.title ILIKE $${i + 2} OR t.summary ILIKE $${i + 2})`).join(' OR ');
      const res = await db.query(
        `SELECT t.id, t.title, t.summary FROM user_threads t
         WHERE t.user_id = $1 ${baseFilter} AND (${conditions})
         ORDER BY t.updated_at DESC LIMIT 3`,
        [userId, ...keywords.map((k: string) => `%${k}%`)]
      );
      if (res.rows.length > 0) { rows = res.rows; isExplicit = true; tier = 'keyword'; }
    }
  }

  // 3. Recent fallback — только фоновый контекст, источники не показываются
  if (rows.length === 0) {
    const res = await db.query(
      `SELECT t.title, t.summary FROM user_threads t
       WHERE t.user_id = $1 ${baseFilter}
       ORDER BY t.updated_at DESC LIMIT 3`,
      [userId]
    );
    rows = res.rows;
    if (rows.length > 0) tier = 'recent';
  }

  // Журнал обращений: только explicit-совпадения. Recent-fallback не логируем —
  // он не запрос-зависим, логирование раздуло бы активацию случайных тредов.
  if (isExplicit) {
    const ids = rows.map((r: any) => r.id).filter(Boolean);
    logAccess(db, userId, ids);
    // Со-вспоминание: извлечённые вместе треды связываются ребром графа
    recordCoRetrieval(db, userId, ids);
  }

  logRetrieval(db, userId, {
    tier,
    queryLen: queryText.length,
    resultsCount: rows.length,
    topSimilarity,
    latencyMs: Date.now() - startedAt,
    keywords: extractKeywords(queryText),
  });

  return { rows, isExplicit };
}
