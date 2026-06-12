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
import { ACCESS_MASS_SQL, activationScore, logAccess } from './activation.ts';

// Слой 1: профильные треды — всегда в промпте, без keyword-matching.
// Возвращает массив summary (до 3), порядок created_at ASC.
export async function getProfileSummaries(db: Db, userId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT summary FROM user_threads
     WHERE user_id = $1
       AND summary IS NOT NULL
       AND is_meaningful IS NOT FALSE
       AND (
         title = 'О себе'
         OR label = 'profile'
         OR (source = 'заметка' AND title ILIKE '%себ%')
       )
     ORDER BY created_at ASC
     LIMIT 3`,
    [userId]
  );
  return rows.map((r: any) => r.summary);
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wа-яё\s]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5);
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
    AND t.label IS DISTINCT FROM 'skill:self_knowledge'
    AND t.title IS DISTINCT FROM 'О себе'
    ${botThreadFilter}
  `;

  let rows: any[] = [];
  let isExplicit = false;

  // 1. Vector search: кандидаты по similarity (порог 0.65, до 10 штук),
  //    итоговый топ-3 — по активации (similarity + история обращений)
  if (opts.vectorEnabled) {
    try {
      const queryEmbedding = await generateEmbedding(queryText, apiKey);
      if (queryEmbedding) {
        const res = await db.query(
          `SELECT t.id, t.title, t.summary,
                  1 - (t.embedding <=> $2::vector) AS similarity,
                  ${ACCESS_MASS_SQL} AS access_mass
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
          rows = res.rows
            .map((r: any) => ({ ...r, _score: activationScore(Number(r.similarity), Number(r.access_mass)) }))
            .sort((a: any, b: any) => b._score - a._score)
            .slice(0, 3);
          isExplicit = true;
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
      if (res.rows.length > 0) { rows = res.rows; isExplicit = true; }
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
  }

  // Журнал обращений: только explicit-совпадения. Recent-fallback не логируем —
  // он не запрос-зависим, логирование раздуло бы активацию случайных тредов.
  if (isExplicit) {
    logAccess(db, userId, rows.map((r: any) => r.id).filter(Boolean));
  }

  return { rows, isExplicit };
}
