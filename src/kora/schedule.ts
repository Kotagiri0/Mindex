// Расписания КОРЫ: типы + чистая математика вычисления следующего запуска.
//
// Принцип (как в ПОЛИСАДе): вся арифметика времени — чистые функции без БД и
// LLM. computeNextRun — единственная нетривиальная по корректности часть всей
// фичи, поэтому она изолирована здесь и покрыта юнит-тестами.
//
// Семантика момента срабатывания зависит от типа задачи:
//   • kind='agent' → срабатывает в локальное time_of_day (тогда же прогоняем КОРУ);
//   • kind='task'  → материализуется в 00:05 локального дня (чтобы весь день
//     висеть в календаре, а напоминание за 15 мин отработал существующий
//     нотификатор). См. src/kora/schedule-store.ts::fireJob.

import { localTimeToUtc, localPartsInTz, addDaysToDateStr } from '../lib/tz.js';

export type ScheduleType = 'once' | 'daily' | 'weekly';
export type ScheduleKind = 'task' | 'agent';

/** Момент материализации task-джоба — начало дня, а не time_of_day. */
export const TASK_MATERIALIZE_TIME = '00:05';

/** Всё, что нужно, чтобы вычислить следующий запуск. Совпадает с колонками
 * scheduled_jobs (schedule-store.ts), но без БД-специфики. */
export interface ScheduleSpec {
  kind: ScheduleKind;
  scheduleType: ScheduleType;
  /** 'HH:MM' локальное — для daily/weekly agent-джоба; для task не влияет на
   * момент срабатывания (тот всегда 00:05), но хранится как время задачи. */
  timeOfDay: string | null;
  /** ISO-дни недели 1..7 (пн..вс) — только для weekly. */
  weekdays: number[] | null;
  timezone: string;
  /** Для 'once' — точный UTC-момент. Для daily/weekly не используется. */
  runAt: Date | null;
}

/** Локальное время (в TZ пользователя), в которое джоб реально срабатывает. */
function fireLocalTime(spec: ScheduleSpec): string {
  if (spec.kind === 'task') return TASK_MATERIALIZE_TIME;
  // agent: строго по времени; если вдруг не задано — 09:00 как безопасный дефолт.
  return normalizeHHMM(spec.timeOfDay) ?? '09:00';
}

/** Приводит время к 'HH:MM' или возвращает null, если не парсится. */
export function normalizeHHMM(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** ISO-день недели (1=пн..7=вс) для календарной даты 'YYYY-MM-DD'.
 * Считаем в полдень UTC — день недели у календарной даты не зависит от TZ. */
export function isoWeekdayOfDate(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0=вс..6=сб
  return d === 0 ? 7 : d;
}

/**
 * Следующий UTC-момент срабатывания строго ПОСЛЕ fromUtc, либо null, если
 * расписание больше не сработает (прошедший 'once', пустой weekly).
 */
export function computeNextRun(spec: ScheduleSpec, fromUtc: Date): Date | null {
  if (spec.scheduleType === 'once') {
    if (!spec.runAt) return null;
    return spec.runAt.getTime() > fromUtc.getTime() ? spec.runAt : null;
  }

  const fire = fireLocalTime(spec);
  const startDate = localPartsInTz(fromUtc, spec.timezone).dateStr;

  const weekdaySet =
    spec.scheduleType === 'weekly'
      ? new Set((spec.weekdays || []).filter(n => n >= 1 && n <= 7))
      : null;
  if (weekdaySet && weekdaySet.size === 0) return null; // weekly без дней — не сработает

  // Скан вперёд: сегодня (может быть ещё впереди по времени) → до 2 недель.
  for (let offset = 0; offset <= 14; offset++) {
    const candidate = addDaysToDateStr(startDate, offset);
    if (weekdaySet && !weekdaySet.has(isoWeekdayOfDate(candidate))) continue;
    const instant = localTimeToUtc(candidate, fire, spec.timezone);
    if (instant.getTime() > fromUtc.getTime()) return instant;
  }
  return null;
}

/** Человекочитаемое описание расписания для UI/ответа Мысли. */
export function describeSchedule(spec: ScheduleSpec): string {
  const t = normalizeHHMM(spec.timeOfDay);
  if (spec.scheduleType === 'once') {
    return spec.runAt ? `один раз ${spec.runAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'один раз';
  }
  if (spec.scheduleType === 'daily') {
    return t ? `каждый день в ${t}` : 'каждый день';
  }
  const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const days = (spec.weekdays || []).filter(n => n >= 1 && n <= 7).map(n => names[n - 1]).join(', ');
  return t ? `по ${days} в ${t}` : `по ${days}`;
}
