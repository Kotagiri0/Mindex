// Часовые пояса: конвертация локального времени пользователя ↔ UTC.
//
// Единая точка правды для планировщиков (напоминания в server-bot.ts,
// расписания в src/kora/schedule.ts). Раньше localTimeToUtc жил приватной
// копией в server-bot.ts — вынесли, чтобы матшкола расписаний считала время
// теми же правилами, что и нотификатор, без риска расхождения.
//
// Чистые функции: только Intl, без сайд-эффектов — безопасно и на сервере,
// и в тестах, и (теоретически) на клиенте.

/**
 * Переводит локальное время пользователя (в его TZ) в UTC-момент.
 * @param dateStr 'YYYY-MM-DD' — локальная дата
 * @param timeStr 'HH:MM' — локальное время
 * @param tz IANA-имя пояса, напр. 'Europe/Moscow'
 */
export function localTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  // Парсим как UTC-момент (точка отсчёта).
  const utcGuess = new Date(`${dateStr}T${timeStr}:00Z`);
  // Смотрим, какое время показывает Intl в нужной TZ для этого момента.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcGuess);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const asTzMs = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) % 24, Number(get('minute')), Number(get('second'))
  );
  // offset = насколько TZ опережает UTC в этот момент.
  const offsetMs = asTzMs - utcGuess.getTime();
  // UTC-эквивалент локального времени пользователя.
  return new Date(utcGuess.getTime() - offsetMs);
}

/** Разобранные компоненты локального времени в конкретной TZ. */
export interface LocalParts {
  year: number;
  month: number;   // 1..12
  day: number;     // 1..31
  hour: number;    // 0..23
  minute: number;  // 0..59
  /** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
  weekday: number;
  /** Локальная дата 'YYYY-MM-DD'. */
  dateStr: string;
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/** Компоненты локального времени в TZ для заданного UTC-момента. */
export function localPartsInTz(at: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekday = ISO_WEEKDAY[get('weekday')] || 1;
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, weekday, dateStr };
}

/** Прибавляет `days` дней к дате 'YYYY-MM-DD' (календарно, в UTC-арифметике). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
