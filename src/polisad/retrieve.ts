// ПОЛИСАД: retrieval — слой 1 (профиль) и слой 2 (семантическая память / RAG).
// Каскад: vector → keyword → recent. Ноль LLM-токенов на retrieval.

import type { ArchiveResult, Db, RetrieveOptions } from './types.ts';
import { generateEmbedding } from './embeddings.ts';
import { BOT_THREAD_TITLE } from './temporal.ts';

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
    ? `AND title NOT LIKE '${BOT_THREAD_TITLE} %'`
    : '';
  const baseFilter = `
    AND summary IS NOT NULL
    AND is_meaningful IS NOT FALSE
    AND label IS DISTINCT FROM 'skill:self_knowledge'
    AND title IS DISTINCT FROM 'О себе'
    ${botThreadFilter}
  `;

  let rows: any[] = [];
  let isExplicit = false;

  // 1. Vector search
  if (opts.vectorEnabled) {
    try {
      const queryEmbedding = await generateEmbedding(queryText, apiKey);
      if (queryEmbedding) {
        const res = await db.query(
          `SELECT title, summary
           FROM user_threads
           WHERE user_id = $1
             AND embedding IS NOT NULL
             ${baseFilter}
             AND 1 - (embedding <=> $2::vector) > 0.65
           ORDER BY embedding <=> $2::vector
           LIMIT 3`,
          [userId, `[${queryEmbedding.join(',')}]`]
        );
        if (res.rows.length > 0) { rows = res.rows; isExplicit = true; }
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
      const conditions = keywords.map((_: string, i: number) => `(title ILIKE $${i + 2} OR summary ILIKE $${i + 2})`).join(' OR ');
      const res = await db.query(
        `SELECT title, summary FROM user_threads
         WHERE user_id = $1 ${baseFilter} AND (${conditions})
         ORDER BY updated_at DESC LIMIT 3`,
        [userId, ...keywords.map((k: string) => `%${k}%`)]
      );
      if (res.rows.length > 0) { rows = res.rows; isExplicit = true; }
    }
  }

  // 3. Recent fallback — только фоновый контекст, источники не показываются
  if (rows.length === 0) {
    const res = await db.query(
      `SELECT title, summary FROM user_threads
       WHERE user_id = $1 ${baseFilter}
       ORDER BY updated_at DESC LIMIT 3`,
      [userId]
    );
    rows = res.rows;
  }

  return { rows, isExplicit };
}
