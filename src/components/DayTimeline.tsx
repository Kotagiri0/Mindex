import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Task } from '../types';
import { categoryColors } from '../lib/taskCategories';
import {
  PlacedTask,
  formatTime,
  parseTime,
  layoutDay,
} from '../lib/timeline';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

/** Высота одного часа в px. Чем больше — тем «воздушнее» сетка. */
const HOUR_H = 88;
/** Левый отступ под колонку часов. */
const GUTTER = 48;
/** Внутренний горизонтальный отступ блоков от правого края. */
const RIGHT_PAD = 16;
/** Зазор между колонками наложенных блоков. */
const COL_GAP = 6;
/** Радиус скругления блоков (на ~25% больше прежних 14). */
const BLOCK_RADIUS = 18;

interface DayTimelineProps {
  date: string;
  tasks: Task[];
  /** Тап по существующему блоку — открыть детали. */
  onTaskClick: (task: Task) => void;
  /** Тап по пустому месту таймлайна — создать на этом времени ("HH:MM"). */
  onCreateAt: (time: string) => void;
  /** Тап по чипу задачи без времени. */
  onUntimedClick: (task: Task) => void;
  /** Перетаскивание блока: новое время начала/конца ("HH:MM"). Длительность сохраняется. */
  onTaskMove?: (taskId: string, time: string, endTime: string) => void;
}

/** Шаг привязки при перетаскивании, минут. */
const SNAP_MIN = 5;

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export default function DayTimeline({
  date,
  tasks,
  onTaskClick,
  onCreateAt,
  onUntimedClick,
  onTaskMove,
}: DayTimelineProps) {
  // Текущее время — обновляем раз в минуту для движения красной линии.
  const [now, setNow] = useState(nowMinutes());
  useEffect(() => {
    const id = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = date === todayStr;

  // Точка отсчёта для авто-раскладки задач без времени: текущее время (сегодня)
  // или 9:00 (прошлые/будущие дни — нет понятия «сейчас»).
  const placeFrom = isToday ? now : 9 * 60;
  const placed = useMemo(() => layoutDay(tasks, placeFrom), [tasks, placeFrom]);

  // Календарь честный — все 24 часа.
  const startHour = 0;
  const endHour = 24;
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const topOffset = startHour * 60;
  const gridHeight = (endHour - startHour) * HOUR_H;

  const scrollRef = useRef<HTMLDivElement>(null);

  // При смене дня — прокрутить к текущему времени (сегодня) или к первому блоку.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let target: number;
    if (isToday) target = now;
    else if (placed.length) target = Math.min(...placed.map((p) => p.startMin));
    else target = 9 * 60;
    const y = ((target - topOffset) / 60) * HOUR_H - 120;
    el.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const minToY = (min: number) => ((min - topOffset) / 60) * HOUR_H;

  // Тап по пустому полю → создать задачу, время округляем до ближайших 15 мин.
  // Клик, исходящий из блока (в т.ч. хвост перетаскивания), отсекается closest().
  const handleGridTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-task-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = topOffset + (y / HOUR_H) * 60;
    const rounded = Math.round(min / 15) * 15;
    onCreateAt(formatTime(rounded));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Скроллируемая сетка времени */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', touchAction: 'pan-y' }}>
        <div
          onClick={handleGridTap}
          style={{ position: 'relative', height: gridHeight, margin: '0 20px 120px' }}
        >
          {/* Часовые линии и подписи */}
          {hours.map((h) => {
            const y = (h * 60 - topOffset) / 60 * HOUR_H;
            return (
              <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: y }}>
                <div
                  style={{
                    position: 'absolute',
                    left: GUTTER,
                    right: 0,
                    top: 0,
                    height: 1,
                    background: 'rgba(34,34,36,0.07)',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: -8,
                    fontFamily: M,
                    fontSize: 13,
                    color: 'rgba(34,34,36,0.35)',
                  }}
                >
                  {h}
                </span>
              </div>
            );
          })}

          {/* Блоки задач (со временем + прикинутые агентом без времени) */}
          {placed.map((p) => (
            <TimelineBlock
              key={p.task.id}
              placed={p}
              top={minToY(p.startMin)}
              height={Math.max(p.untimed ? 30 : 34, ((p.endMin - p.startMin) / 60) * HOUR_H - 4)}
              hourH={HOUR_H}
              minStart={topOffset}
              maxEnd={endHour * 60}
              onClick={() => (p.untimed ? onUntimedClick(p.task) : onTaskClick(p.task))}
              onMove={p.untimed ? undefined : onTaskMove}
            />
          ))}

          {/* Едущая красная линия текущего времени (только сегодня) */}
          {isToday && (
            <div
              style={{
                position: 'absolute',
                left: GUTTER - 7,
                right: 0,
                top: minToY(now),
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FF3B30', flexShrink: 0 }} />
              <span style={{ flex: 1, height: 2, background: '#FF3B30' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineBlock({
  placed,
  top,
  height,
  hourH,
  minStart,
  maxEnd,
  onClick,
  onMove,
}: {
  placed: PlacedTask;
  top: number;
  height: number;
  hourH: number;
  minStart: number;
  maxEnd: number;
  onClick: () => void;
  onMove?: (taskId: string, time: string, endTime: string) => void;
}) {
  const { task, startMin, endMin, col, cols, untimed } = placed;
  const colors = categoryColors(task.category);
  const duration = endMin - startMin;

  // Смещение по Y во время перетаскивания (px). null — не тащим.
  const [dragDy, setDragDy] = useState<number | null>(null);
  const drag = useRef<{
    startY: number;
    active: boolean;
    longPressId: ReturnType<typeof setTimeout> | null;
    pointerId: number;
  } | null>(null);
  // Гасит click, который браузер генерит сразу после pointerup завершившегося drag.
  const suppressClick = useRef(false);

  const pxPerMin = hourH / 60;

  // Ширина в процентах с учётом колонок наложения.
  const widthCalc = `calc((100% - ${GUTTER}px - ${RIGHT_PAD}px - ${(cols - 1) * COL_GAP}px) / ${cols})`;
  const leftCalc = `calc(${GUTTER}px + (${widthCalc} + ${COL_GAP}px) * ${col})`;

  const start = parseTime(task.time);
  const end = parseTime(task.endTime);
  const timeLabel =
    start !== null && end !== null && end > start
      ? `${task.time} - ${task.endTime}`
      : task.time;

  // Задача без времени — тонкий серый чип: одна строка, без времени, без перетаскивания.
  const compact = untimed || height < 52;
  const draggable = !!onMove && !untimed;

  const beginDrag = (clientY: number, pointerId: number, el: HTMLElement, immediate: boolean) => {
    const startDrag = () => {
      drag.current!.active = true;
      setDragDy(0);
      try { el.setPointerCapture(pointerId); } catch {}
    };
    drag.current = { startY: clientY, active: false, longPressId: null, pointerId };
    if (immediate) startDrag();
    else drag.current.longPressId = setTimeout(startDrag, 220); // long-press на тач
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    // Мышь/перо — тащим сразу; палец — через long-press, чтобы не мешать скроллу.
    beginDrag(e.clientY, e.pointerId, e.currentTarget, e.pointerType !== 'touch');
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Палец сдвинулся до срабатывания long-press → это скролл, отменяем drag.
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) > 8 && d.longPressId) {
        clearTimeout(d.longPressId);
        drag.current = null;
      }
      return;
    }
    e.preventDefault();
    setDragDy(e.clientY - d.startY);
  };

  const finishDrag = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    if (d.longPressId) clearTimeout(d.longPressId);
    if (d.active) {
      // Был реальный drag → гасим следующий click (детали не открываем).
      suppressClick.current = true;
      if (commit && dragDy !== null && onMove) {
        const deltaMin = Math.round(dragDy / pxPerMin / SNAP_MIN) * SNAP_MIN;
        let newStart = startMin + deltaMin;
        // Не выпускаем за границы видимого диапазона.
        newStart = Math.max(minStart, Math.min(maxEnd - duration, newStart));
        if (newStart !== startMin) {
          onMove(task.id, formatTime(newStart), formatTime(newStart + duration));
        }
      }
    }
    drag.current = null;
    setDragDy(null);
  };

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onClick();
  };

  const isDragging = dragDy !== null;

  return (
    <motion.div
      data-task-block
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(false)}
      onClick={handleClick}
      whileTap={!draggable ? { scale: 0.985 } : undefined}
      style={{
        position: 'absolute',
        top,
        left: leftCalc,
        width: widthCalc,
        height,
        transform: isDragging ? `translateY(${dragDy}px)` : undefined,
        background: untimed ? '#EFEFF0' : colors.bg,
        border: 'none',
        borderRadius: untimed ? 12 : BLOCK_RADIUS,
        padding: untimed ? '6px 14px' : (compact ? '6px 14px' : '9px 16px'),
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        overflow: 'hidden',
        cursor: draggable ? 'grab' : 'pointer',
        opacity: task.done ? 0.55 : 1,
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
        zIndex: isDragging ? 20 : 1,
        touchAction: 'pan-y',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s',
      }}
    >
      {!compact && !untimed && (
        <span style={{ fontFamily: M, fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
          {isDragging
            ? formatTime(Math.max(minStart, Math.min(maxEnd - duration, startMin + Math.round((dragDy ?? 0) / pxPerMin / SNAP_MIN) * SNAP_MIN)))
            : timeLabel}
        </span>
      )}
      <span
        style={{
          fontFamily: M,
          fontSize: untimed ? 13 : 15,
          fontWeight: untimed ? 400 : 500,
          color: untimed ? 'rgba(34,34,36,0.7)' : colors.text,
          lineHeight: 1.2,
          textDecoration: task.done ? 'line-through' : 'none',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          display: untimed ? 'block' : '-webkit-box',
          WebkitLineClamp: compact ? 1 : 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {task.name}
      </span>
    </motion.div>
  );
}
