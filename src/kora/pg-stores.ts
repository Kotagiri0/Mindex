// Postgres-имплементации PendingStore/GateAuditLog для боевого сервера (Фаза 9A).
// См. src/kora/hitl.ts — интерфейсы и почему это ИНТЕРФЕЙСЫ, не прямые
// структуры данных (Docker, рестарты, потенциально несколько инстансов).
//
// ПРОД-режим: только additive-миграции (CREATE TABLE IF NOT EXISTS), никаких
// ALTER/DROP существующих таблиц продукта. Чистый SQL, без ORM.

import type { Pool } from 'pg';
import type { GateAuditEvent, GateAuditLog, PendingAction, PendingStore } from './hitl.js';

/** Создаёт таблицы КОРЫ, если их ещё нет. Безопасно вызывать при каждом
 * старте сервера — IF NOT EXISTS, никакой существующей таблицы не трогает. */
export async function ensureKoraTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kora_pending_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      actions JSONB NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS kora_pending_actions_user_thread_idx
      ON kora_pending_actions (user_id, thread_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kora_gate_audit (
      id BIGSERIAL PRIMARY KEY,
      ts BIGINT NOT NULL,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB,
      rule TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kora_artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      html TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}

/** Один активный pending на (userId, threadId) — тот же инвариант, что у
 * InMemoryPendingStore (put перезаписывает предыдущий активный). */
export class PgPendingStore implements PendingStore {
  constructor(private readonly pool: Pool) {}

  async put(pending: PendingAction): Promise<void> {
    // Один pending на (userId, threadId): предыдущий (если был) заменяется.
    await this.pool.query(
      `DELETE FROM kora_pending_actions WHERE user_id = $1 AND thread_id = $2`,
      [pending.userId, pending.threadId]
    );
    await this.pool.query(
      `INSERT INTO kora_pending_actions (id, user_id, thread_id, created_at, actions)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [pending.id, pending.userId, pending.threadId, pending.createdAt, JSON.stringify(pending.actions)]
    );
  }

  async getActive(userId: string, threadId: string): Promise<PendingAction | null> {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, thread_id, created_at, actions
       FROM kora_pending_actions
       WHERE user_id = $1 AND thread_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [userId, threadId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      threadId: r.thread_id,
      createdAt: Number(r.created_at),
      actions: r.actions,
    };
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM kora_pending_actions WHERE id = $1`, [id]);
  }
}

export class PgGateAuditLog implements GateAuditLog {
  constructor(private readonly pool: Pool) {}

  async append(event: GateAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO kora_gate_audit (ts, user_id, thread_id, kind, payload, rule)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [event.ts, event.userId, event.threadId, event.kind, JSON.stringify(event.payload ?? null), event.rule ?? null]
    );
  }
}
