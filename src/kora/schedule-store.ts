// Хранилище расписаний КОРЫ (scheduled_jobs). Чистый SQL, без ORM.
//
// ПРОД-режим: только additive-миграции (CREATE TABLE IF NOT EXISTS) — как в
// pg-stores.ts. Планировщик (server-bot.ts::startScheduleRunner) — единственный
// писатель next_run_at при срабатывании; claimDueJobs использует compare-and-swap
// по next_run_at, чтобы параллельный тик или второй инстанс не сработали дважды.

import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { computeNextRun, type ScheduleKind, type ScheduleType, type ScheduleSpec } from './schedule.js';

export interface ScheduledJob {
  id: string;
  userId: string;
  title: string;
  kind: ScheduleKind;
  instruction: string | null;
  scheduleType: ScheduleType;
  timeOfDay: string | null;
  weekdays: number[] | null;
  timezone: string;
  nextRunAt: Date;
  active: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
}

export async function ensureScheduleTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'task',
      instruction TEXT,
      schedule_type TEXT NOT NULL,
      time_of_day TEXT,
      weekdays SMALLINT[],
      timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
      next_run_at TIMESTAMPTZ NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Частичный индекс — сканер планировщика ходит только по активным.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx
      ON scheduled_jobs (next_run_at) WHERE active
  `);
}

function rowToJob(r: any): ScheduledJob {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    kind: r.kind,
    instruction: r.instruction ?? null,
    scheduleType: r.schedule_type,
    timeOfDay: r.time_of_day ?? null,
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.map((n: any) => Number(n)) : null,
    timezone: r.timezone,
    nextRunAt: new Date(r.next_run_at),
    active: r.active,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at) : null,
    createdAt: new Date(r.created_at),
  };
}

export function jobToSpec(job: {
  kind: ScheduleKind; scheduleType: ScheduleType; timeOfDay: string | null;
  weekdays: number[] | null; timezone: string; nextRunAt?: Date | null;
}, runAt: Date | null = null): ScheduleSpec {
  return {
    kind: job.kind,
    scheduleType: job.scheduleType,
    timeOfDay: job.timeOfDay,
    weekdays: job.weekdays,
    timezone: job.timezone,
    runAt,
  };
}

export interface CreateJobParams {
  userId: string;
  title: string;
  kind: ScheduleKind;
  instruction?: string | null;
  scheduleType: ScheduleType;
  timeOfDay?: string | null;
  weekdays?: number[] | null;
  timezone: string;
  /** Для 'once' — точный UTC-момент запуска. */
  runAt?: Date | null;
}

/** Создаёт расписание, вычислив первый next_run_at. Возвращает джоб либо null,
 * если расписание не сработает никогда (прошедший 'once', пустой weekly). */
export async function createJob(pool: Pool, p: CreateJobParams): Promise<ScheduledJob | null> {
  const now = new Date();
  const spec = jobToSpec(
    { kind: p.kind, scheduleType: p.scheduleType, timeOfDay: p.timeOfDay ?? null, weekdays: p.weekdays ?? null, timezone: p.timezone },
    p.runAt ?? null
  );
  const next = computeNextRun(spec, now);
  if (!next) return null;

  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO scheduled_jobs
       (id, user_id, title, kind, instruction, schedule_type, time_of_day, weekdays, timezone, next_run_at, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
     RETURNING *`,
    [
      id, p.userId, p.title, p.kind, p.instruction ?? null, p.scheduleType,
      p.timeOfDay ?? null, p.weekdays ?? null, p.timezone, next.toISOString(),
    ]
  );
  return rowToJob(rows[0]);
}

export async function listJobs(pool: Pool, userId: string, activeOnly = true): Promise<ScheduledJob[]> {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_jobs
     WHERE user_id = $1 ${activeOnly ? 'AND active = true' : ''}
     ORDER BY next_run_at ASC`,
    [userId]
  );
  return rows.map(rowToJob);
}

/** Отменяет (деактивирует) расписание. Возвращает true, если что-то отменили. */
export async function cancelJob(pool: Pool, id: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE scheduled_jobs SET active = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND active = true`,
    [id, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Атомарно «заявляет» созревшие расписания и СРАЗУ переносит их на следующий
 * запуск (или деактивирует 'once'/исчерпанный weekly). Возвращает джобы,
 * которые именно этот вызов успешно заявил — их и надо исполнить.
 *
 * CAS по next_run_at: если параллельный тик уже перенёс джоб, наш UPDATE не
 * найдёт строку со старым next_run_at и мы его не заявим. Перенос ДО исполнения
 * означает «не более одного срабатывания», ценой возможной потери одного
 * вхождения при краше между заявкой и доставкой — приемлемо для повторяющихся.
 */
export async function claimDueJobs(pool: Pool, now: Date, limit = 50): Promise<ScheduledJob[]> {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_jobs
     WHERE active = true AND next_run_at <= $1
     ORDER BY next_run_at ASC LIMIT $2`,
    [now.toISOString(), limit]
  );

  const claimed: ScheduledJob[] = [];
  for (const r of rows) {
    const job = rowToJob(r);
    // Для 'once' next=null → деактивируем (сработал один раз). Для повторов —
    // строго следующее вхождение после now (runAt для них не нужен).
    const next = job.scheduleType === 'once' ? null : computeNextRun(jobToSpec(job), now);
    const res = await pool.query(
      `UPDATE scheduled_jobs
       SET next_run_at = COALESCE($3, next_run_at),
           active = $4,
           last_run_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND next_run_at = $2 AND active = true
       RETURNING id`,
      [job.id, r.next_run_at, next ? next.toISOString() : null, next !== null]
    );
    if ((res.rowCount ?? 0) > 0) claimed.push(job);
  }
  return claimed;
}
