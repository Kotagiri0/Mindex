// ПОЛИСАД: публичный HTTP-API (B2B-граница).
//
// Тонкий Express-роутер поверх существующих функций модуля. Не содержит
// бизнес-логики — только маппинг HTTP ⇄ retrieveArchive / getProfileSummaries /
// summarizeThreadCore. Нужен внешним потребителям (напр. КОРА / Sreda LM),
// которые не на Node и не могут импортировать модуль напрямую.
//
// Аутентификация: shared-secret через заголовок X-Polisad-Key (POLISAD_API_KEY).
// Это межсервисный API без пользовательских сессий — userId приходит в теле.

import express from 'express';
import type { ChatCall, Db } from './types.ts';
import { getProfileSummaries, retrieveArchive } from './retrieve.ts';
import { summarizeThreadCore } from './summarize.ts';

export interface PolisadApiDeps {
  db: Db | null;
  callChat: ChatCall;
  apiKey: string | undefined;
  // vectorEnabled читается на каждый запрос — флаг выставляется асинхронно при старте
  isVectorEnabled: () => boolean;
}

export function createPolisadApi(deps: PolisadApiDeps): express.Router {
  const router = express.Router();
  const secret = process.env.POLISAD_API_KEY;

  // Shared-secret guard. Если ключ не задан в окружении — API отключён,
  // чтобы случайно не выставить чужую память наружу без аутентификации.
  router.use((req, res, next) => {
    if (!secret) return res.status(503).json({ error: 'POLISAD_API_KEY не задан — API отключён' });
    if (req.headers['x-polisad-key'] !== secret) return res.status(401).json({ error: 'Неверный X-Polisad-Key' });
    if (!deps.db) return res.status(500).json({ error: 'БД не настроена' });
    next();
  });

  // Слой 2: контекст для промпта — каскад vector → keyword → recent.
  // POST /polisad/context  { userId, query } → { rows, isExplicit }
  router.post('/context', async (req, res) => {
    const { userId, query } = req.body || {};
    if (!userId || typeof query !== 'string') {
      return res.status(400).json({ error: 'нужны поля userId (str) и query (str)' });
    }
    try {
      const result = await retrieveArchive(deps.db!, String(userId), query, deps.apiKey, {
        vectorEnabled: deps.isVectorEnabled(),
        excludeBotThreads: false,
      });
      return res.json(result);
    } catch (e: any) {
      console.error('[polisad/api] context', e?.message);
      return res.status(500).json({ error: e?.message || 'context failed' });
    }
  });

  // Слой 1: профиль пользователя — всегда в промпт, без поиска.
  // GET /polisad/profile?userId=... → { profiles: string[] }
  router.get('/profile', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'нужен query-параметр userId' });
    try {
      const profiles = await getProfileSummaries(deps.db!, String(userId));
      return res.json({ profiles });
    } catch (e: any) {
      console.error('[polisad/api] profile', e?.message);
      return res.status(500).json({ error: e?.message || 'profile failed' });
    }
  });

  // Создание памяти: саммаризация треда (единственное место с LLM).
  // POST /polisad/remember { userId, threadId, messages } → { summary, isMeaningful }
  router.post('/remember', async (req, res) => {
    const { userId, threadId, messages } = req.body || {};
    if (!userId || !threadId || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'нужны поля userId (str), threadId (str), messages (array)' });
    }
    if (!deps.apiKey) return res.status(500).json({ error: 'ROUTERAI_API_KEY не задан' });
    try {
      const result = await summarizeThreadCore(
        deps.db!, deps.callChat, deps.apiKey, String(threadId), String(userId), messages
      );
      if (!result) return res.status(502).json({ error: 'LLM-провайдер недоступен' });
      return res.json(result);
    } catch (e: any) {
      console.error('[polisad/api] remember', e?.message);
      return res.status(500).json({ error: e?.message || 'remember failed' });
    }
  });

  return router;
}
