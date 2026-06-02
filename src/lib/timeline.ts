import { Task } from '../types';

/** Дефолтная длительность блока-точки (есть start, нет end), в минутах. */
export const DEFAULT_DURATION_MIN = 60;

/** "HH:MM" → минуты от полуночи. Невалидно → null. */
export const parseTime = (value?: string): number | null => {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/** Минуты от полуночи → "HH:MM" (обрезается в [0, 24*60)). */
export const formatTime = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export interface PlacedTask {
  task: Task;
  /** Минуты от полуночи — начало. */
  startMin: number;
  /** Минуты от полуночи — конец (start + длительность, минимум +15). */
  endMin: number;
  /** Колонка для разрешения наложений (0..colsCount-1). */
  col: number;
  /** Сколько всего колонок в кластере наложения этой задачи. */
  cols: number;
}

/**
 * Разбивает задачи дня на:
 *  - timed: имеющие валидное время начала → раскладываются в таймлайн с разрешением наложений;
 *  - untimed: без времени → показываются чипами в строку.
 */
export const splitDayTasks = (tasks: Task[]): { timed: PlacedTask[]; untimed: Task[] } => {
  const untimed: Task[] = [];
  const raw: { task: Task; startMin: number; endMin: number }[] = [];

  for (const task of tasks) {
    const startMin = parseTime(task.time);
    if (startMin === null) {
      untimed.push(task);
      continue;
    }
    const endParsed = parseTime(task.endTime);
    const endMin =
      endParsed !== null && endParsed > startMin
        ? endParsed
        : Math.min(24 * 60, startMin + DEFAULT_DURATION_MIN);
    raw.push({ task, startMin, endMin: Math.max(endMin, startMin + 15) });
  }

  raw.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Разрешение наложений: жадно раскладываем по колонкам внутри кластеров пересечений.
  const placed: PlacedTask[] = [];
  let cluster: typeof raw = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = []; // время окончания последней задачи в каждой колонке
    const assigned = cluster.map((item) => {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      return { ...item, col };
    });
    const cols = colEnds.length;
    for (const item of assigned) placed.push({ ...item, cols });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of raw) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();

  return { timed: placed, untimed };
};

/** Видимый диапазон часов таймлайна с учётом задач (минимум 8:00–20:00, расширяется под крайние). */
export const visibleHourRange = (timed: PlacedTask[]): { startHour: number; endHour: number } => {
  let startHour = 8;
  let endHour = 20;
  for (const p of timed) {
    startHour = Math.min(startHour, Math.floor(p.startMin / 60));
    endHour = Math.max(endHour, Math.ceil(p.endMin / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
};
