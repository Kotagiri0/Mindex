import { Task } from '../types';

/** Дефолтная длительность блока-точки (есть start, нет end), в минутах. */
export const DEFAULT_DURATION_MIN = 60;

/** Длительность слота, который агент прикидывает для задачи без времени (тонкий чип). */
export const UNTIMED_SLOT_MIN = 30;

/** Рабочее окно дня для авто-раскладки задач без времени (не ставим ночью). */
export const WORK_START_MIN = 8 * 60;   // 08:00
export const WORK_END_MIN = 23 * 60;    // 23:00

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
  /** true — задача без времени, слот прикинут автоматически (тонкий серый чип). */
  untimed?: boolean;
}

interface RawPlaced {
  task: Task;
  startMin: number;
  endMin: number;
  untimed?: boolean;
}

/** Назначает колонки внутри кластеров пересечений (жадно). Мутирует — возвращает PlacedTask[]. */
const assignColumns = (raw: RawPlaced[]): PlacedTask[] => {
  const sorted = [...raw].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: PlacedTask[] = [];
  let cluster: RawPlaced[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
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

  for (const item of sorted) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return placed;
};

/**
 * Подбирает агентом (в коде, скрыто от пользователя) слот для задачи без времени
 * в свободном окне дня. НЕ меняет данные задачи — это только визуальное предложение.
 *
 * Ищем первое окно длиной UNTIMED_SLOT_MIN в рабочем окне [WORK_START..WORK_END],
 * начиная с max(fromMin, WORK_START), которое не пересекает занятые интервалы.
 * Если день забит до конца рабочего окна — складываем рядом в дневные слоты
 * (не уходим в ночь): возвращаем последнюю позицию внутри окна.
 */
const findFreeSlot = (busy: { s: number; e: number }[], fromMin: number): number => {
  const sorted = [...busy].sort((a, b) => a.s - b.s);
  let cursor = Math.max(WORK_START_MIN, fromMin);
  for (const b of sorted) {
    if (b.e <= cursor) continue;
    if (b.s - cursor >= UNTIMED_SLOT_MIN) return cursor; // влезает перед этим занятым
    cursor = Math.max(cursor, b.e);
  }
  // Не уходим за рабочее окно — при переполнении клеим к последнему дневному слоту.
  if (cursor + UNTIMED_SLOT_MIN <= WORK_END_MIN) return cursor;
  return Math.max(WORK_START_MIN, WORK_END_MIN - UNTIMED_SLOT_MIN);
};

/**
 * Раскладывает все задачи дня на таймлайн:
 *  - задачи со временем — как есть, с разрешением наложений;
 *  - задачи без времени — агент прикидывает им слот в свободном окне (тонкий серый чип),
 *    начиная с `nowMin` (или с начала дня). Несколько подряд в одно окно встают рядом.
 *
 * `nowMin` — точка отсчёта для поиска свободных окон (обычно текущее время дня).
 */
export const layoutDay = (tasks: Task[], nowMin: number): PlacedTask[] => {
  const timedRaw: RawPlaced[] = [];
  const untimedTasks: Task[] = [];

  for (const task of tasks) {
    const startMin = parseTime(task.time);
    if (startMin === null) {
      untimedTasks.push(task);
      continue;
    }
    const endParsed = parseTime(task.endTime);
    const endMin =
      endParsed !== null && endParsed > startMin
        ? endParsed
        : Math.min(24 * 60, startMin + DEFAULT_DURATION_MIN);
    timedRaw.push({ task, startMin, endMin: Math.max(endMin, startMin + 15) });
  }

  const busy = timedRaw.map((t) => ({ s: t.startMin, e: t.endMin }));
  const untimedRaw: RawPlaced[] = [];

  // 1) Задачи, которым агент уже предложил время (suggestedTime) — ставим туда напрямую.
  //    Это "мысль" модели о лучшем слоте; алгоритм её не пересчитывает.
  const fallbackTasks: Task[] = [];
  for (const task of untimedTasks) {
    const s = parseTime(task.suggestedTime);
    if (s === null) { fallbackTasks.push(task); continue; }
    const e = parseTime(task.suggestedEndTime);
    const endMin = e !== null && e > s ? e : s + UNTIMED_SLOT_MIN;
    untimedRaw.push({ task, startMin: s, endMin, untimed: true });
    // suggested-слоты не блокируют busy друг для друга — пусть стоят рядом, если совпали.
  }

  // 2) Остальные — fallback-алгоритм: первое свободное дневное окно от текущего времени.
  //    Несколько подряд садятся в одно окно (по 2 в ряд), колонки разведёт assignColumns.
  const from = Math.max(WORK_START_MIN, Math.min(nowMin, WORK_END_MIN - UNTIMED_SLOT_MIN));
  const PER_ROW = 2;
  if (fallbackTasks.length) {
    let slotStart = findFreeSlot(busy, from);
    let inRow = 0;
    for (const task of fallbackTasks) {
      if (inRow >= PER_ROW) {
        busy.push({ s: slotStart, e: slotStart + UNTIMED_SLOT_MIN });
        slotStart = findFreeSlot(busy, slotStart + UNTIMED_SLOT_MIN);
        inRow = 0;
      }
      untimedRaw.push({ task, startMin: slotStart, endMin: slotStart + UNTIMED_SLOT_MIN, untimed: true });
      inRow++;
    }
  }

  return assignColumns([...timedRaw, ...untimedRaw]);
};
