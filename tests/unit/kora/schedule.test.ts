import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRun,
  isoWeekdayOfDate,
  normalizeHHMM,
  describeSchedule,
  type ScheduleSpec,
} from '../../../src/kora/schedule.ts';
import { localTimeToUtc, localPartsInTz } from '../../../src/lib/tz.ts';

const MSK = 'Europe/Moscow'; // UTC+3, без перехода на летнее время

function agentDaily(timeOfDay: string, tz = MSK): ScheduleSpec {
  return { kind: 'agent', scheduleType: 'daily', timeOfDay, weekdays: null, timezone: tz, runAt: null };
}
function agentWeekly(timeOfDay: string, weekdays: number[], tz = MSK): ScheduleSpec {
  return { kind: 'agent', scheduleType: 'weekly', timeOfDay, weekdays, timezone: tz, runAt: null };
}

test('normalizeHHMM: чистит и зажимает', () => {
  assert.equal(normalizeHHMM('9:00'), '09:00');
  assert.equal(normalizeHHMM('23:59'), '23:59');
  assert.equal(normalizeHHMM('25:70'), '23:59');
  assert.equal(normalizeHHMM('утром'), null);
  assert.equal(normalizeHHMM(null), null);
});

test('isoWeekdayOfDate: пн=1..вс=7, TZ-независимо', () => {
  assert.equal(isoWeekdayOfDate('2026-07-20'), 1); // понедельник
  assert.equal(isoWeekdayOfDate('2026-07-26'), 7); // воскресенье
});

test('daily agent: если сегодняшнее время ещё впереди — берём сегодня', () => {
  // now = 2026-07-22 06:00 МСК (03:00 UTC), расписание на 09:00 МСК
  const now = localTimeToUtc('2026-07-22', '06:00', MSK);
  const next = computeNextRun(agentDaily('09:00'), now);
  assert.ok(next);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-22');
  assert.equal(p.hour, 9);
  assert.equal(p.minute, 0);
});

test('daily agent: если время сегодня уже прошло — берём завтра', () => {
  // now = 2026-07-22 10:00 МСК, расписание 09:00 → завтра
  const now = localTimeToUtc('2026-07-22', '10:00', MSK);
  const next = computeNextRun(agentDaily('09:00'), now);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-23');
  assert.equal(p.hour, 9);
});

test('daily agent: ровно в момент срабатывания — строго ПОСЛЕ, значит завтра', () => {
  const now = localTimeToUtc('2026-07-22', '09:00', MSK);
  const next = computeNextRun(agentDaily('09:00'), now);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-23');
});

test('weekly agent: несколько дней, ближайший в этой неделе', () => {
  // now = среда 2026-07-22 12:00 МСК; дни пн(1), пт(5); ближайший — пт 24-го
  const now = localTimeToUtc('2026-07-22', '12:00', MSK);
  const next = computeNextRun(agentWeekly('09:00', [1, 5]), now);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-24'); // пятница
  assert.equal(p.hour, 9);
});

test('weekly agent: перелистывание на следующую неделю', () => {
  // now = пятница 2026-07-24 12:00 МСК; единственный день пн(1) → пн 27-го
  const now = localTimeToUtc('2026-07-24', '12:00', MSK);
  const next = computeNextRun(agentWeekly('09:00', [1]), now);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-27'); // понедельник след. недели
});

test('weekly: пустой список дней → null (не сработает никогда)', () => {
  const now = localTimeToUtc('2026-07-22', '12:00', MSK);
  assert.equal(computeNextRun(agentWeekly('09:00', []), now), null);
});

test('once: будущий момент возвращается как есть, прошедший → null', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const future = new Date('2026-07-22T13:00:00Z');
  const past = new Date('2026-07-22T11:00:00Z');
  const spec = (runAt: Date): ScheduleSpec =>
    ({ kind: 'agent', scheduleType: 'once', timeOfDay: null, weekdays: null, timezone: MSK, runAt });
  assert.equal(computeNextRun(spec(future), now)?.toISOString(), future.toISOString());
  assert.equal(computeNextRun(spec(past), now), null);
});

test('task-kind: срабатывает в 00:05 локального дня, НЕ в time_of_day', () => {
  // now = 2026-07-22 08:00 МСК; daily task с временем 14:00 → материализация
  // в 00:05 завтрашнего дня (сегодняшние 00:05 уже прошли).
  const now = localTimeToUtc('2026-07-22', '08:00', MSK);
  const spec: ScheduleSpec = {
    kind: 'task', scheduleType: 'daily', timeOfDay: '14:00', weekdays: null, timezone: MSK, runAt: null,
  };
  const next = computeNextRun(spec, now);
  const p = localPartsInTz(next!, MSK);
  assert.equal(p.dateStr, '2026-07-23');
  assert.equal(p.hour, 0);
  assert.equal(p.minute, 5);
});

test('TZ: расписание считается в поясе пользователя, не в UTC-серверном', () => {
  // Владивосток UTC+10. now = 2026-07-22 23:00 VLAT = 13:00 UTC.
  // daily 09:00 VLAT: сегодняшние 09:00 VLAT (2026-07-22) уже прошли → завтра.
  const tz = 'Asia/Vladivostok';
  const now = localTimeToUtc('2026-07-22', '23:00', tz);
  const next = computeNextRun(agentDaily('09:00', tz), now);
  const p = localPartsInTz(next!, tz);
  assert.equal(p.dateStr, '2026-07-23');
  assert.equal(p.hour, 9);
});

test('describeSchedule: человекочитаемо', () => {
  assert.equal(describeSchedule(agentDaily('09:00')), 'каждый день в 09:00');
  assert.match(describeSchedule(agentWeekly('09:00', [1, 5])), /по пн, пт в 09:00/);
});
