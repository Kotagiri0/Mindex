// Инструменты КОРЫ для расписаний: создать / список / отменить.
// Регистрируются в обоих реестрах (server.ts и server-bot.ts) — паритет путей.
//
// Философия HITL: 'создать' — не write-действие (isWrite:false), т.к. контактирует
// только с самим пользователем и не имеет внешних сайд-эффектов. Если agent-джоб
// при СРАБАТЫВАНИИ захочет внешнее действие — гейт отработает уже в момент прогона
// (см. server-bot.ts::runScheduledAgent → HITL pending).

import type { Pool } from 'pg';
import type { ToolDef } from './registry.js';
import { normalizeHHMM, describeSchedule, type ScheduleKind, type ScheduleType } from './schedule.js';
import { createJob, listJobs, cancelJob, jobToSpec } from './schedule-store.js';
import { localTimeToUtc } from '../lib/tz.js';

async function resolveTz(pool: Pool, userId: string): Promise<string> {
  try {
    const { rows } = await pool.query(`SELECT timezone FROM user_profiles WHERE user_id = $1`, [userId]);
    return rows[0]?.timezone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

function parseWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return out.length ? Array.from(new Set(out)).sort((a, b) => a - b) : null;
}

export function scheduleCreateTool(pool: Pool, userId: string): ToolDef {
  return {
    name: 'расписание.создать',
    description:
      'Завести повторяющееся или отложенное дело. kind="task" — просто задача/напоминание в календаре ' +
      '(«каждое утро зарядка»). kind="agent" — автозапуск тебя самой с инструкцией из поля instruction ' +
      '(«каждый будни в 9 собери сводку и пришли»). schedule_type: "daily" (каждый день, нужно time), ' +
      '"weekly" (нужно weekdays + time), "once" (нужно date + time). weekdays — числа 1..7 (пн..вс).',
    argsSchema: {
      title: { type: 'string', required: true, description: 'коротко о чём расписание', maxLen: 200 },
      kind: { type: 'string', required: true, description: '"task" или "agent"' },
      schedule_type: { type: 'string', required: true, description: '"once" | "daily" | "weekly"' },
      instruction: { type: 'string', required: false, description: 'что сделать при срабатывании (для kind="agent")', maxLen: 2000 },
      time: { type: 'string', required: false, description: 'время HH:MM (локальное)' },
      weekdays: { type: 'array', required: false, description: 'дни недели 1..7 для weekly' },
      date: { type: 'string', required: false, description: 'дата YYYY-MM-DD для once' },
    },
    isWrite: false,
    execute: async (args) => {
      const title = String(args.title ?? '').trim();
      const kind = (String(args.kind ?? 'task') === 'agent' ? 'agent' : 'task') as ScheduleKind;
      const rawType = String(args.schedule_type ?? '').toLowerCase();
      const scheduleType = (['once', 'daily', 'weekly'].includes(rawType) ? rawType : 'daily') as ScheduleType;
      const time = normalizeHHMM(args.time as string | undefined);
      const weekdays = parseWeekdays(args.weekdays);
      const instruction = args.instruction ? String(args.instruction).slice(0, 2000) : null;

      if (!title) return { error: 'нужно поле title' };
      if (kind === 'agent' && !instruction) {
        return { error: 'для kind="agent" нужно поле instruction — что именно сделать при срабатывании' };
      }
      if (scheduleType === 'weekly' && !weekdays) {
        return { error: 'для weekly нужно поле weekdays — дни недели числами 1..7' };
      }
      if ((scheduleType === 'daily' || scheduleType === 'weekly') && kind === 'agent' && !time) {
        return { error: 'для agent-расписания нужно время time в формате HH:MM' };
      }

      const tz = await resolveTz(pool, userId);

      let runAt: Date | null = null;
      if (scheduleType === 'once') {
        const date = String(args.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) {
          return { error: 'для once нужны поля date (YYYY-MM-DD) и time (HH:MM)' };
        }
        runAt = localTimeToUtc(date, time, tz);
        if (runAt.getTime() <= Date.now()) return { error: 'момент запуска уже в прошлом' };
      }

      const job = await createJob(pool, {
        userId, title, kind, instruction, scheduleType,
        timeOfDay: time, weekdays, timezone: tz, runAt,
      });
      if (!job) return { error: 'расписание не сработает никогда — проверь параметры' };

      const spec = jobToSpec(job, runAt);
      return {
        success: true,
        id: job.id,
        title: job.title,
        kind: job.kind,
        schedule: describeSchedule(spec),
        next_run_utc: job.nextRunAt.toISOString(),
      };
    },
  };
}

export function scheduleListTool(pool: Pool, userId: string): ToolDef {
  return {
    name: 'расписание.список',
    description: 'Показать активные расписания пользователя (id, что, когда).',
    argsSchema: {},
    isWrite: false,
    execute: async () => {
      const jobs = await listJobs(pool, userId, true);
      return {
        schedules: jobs.map((j) => ({
          id: j.id,
          title: j.title,
          kind: j.kind,
          schedule: describeSchedule(jobToSpec(j)),
          next_run_utc: j.nextRunAt.toISOString(),
        })),
      };
    },
  };
}

export function scheduleCancelTool(pool: Pool, userId: string): ToolDef {
  return {
    name: 'расписание.отменить',
    description: 'Отменить (выключить) расписание по id. Сначала возьми id из расписание.список.',
    argsSchema: {
      id: { type: 'string', required: true, description: 'id расписания' },
    },
    isWrite: false,
    execute: async (args) => {
      const id = String(args.id ?? '').trim();
      if (!id) return { error: 'нужно поле id' };
      const ok = await cancelJob(pool, id, userId);
      return ok ? { success: true } : { error: 'расписание не найдено или уже отменено' };
    },
  };
}

/** Все три инструмента расписаний одним набором — для регистрации в реестре. */
export function scheduleTools(pool: Pool, userId: string): ToolDef[] {
  return [
    scheduleCreateTool(pool, userId),
    scheduleListTool(pool, userId),
    scheduleCancelTool(pool, userId),
  ];
}
