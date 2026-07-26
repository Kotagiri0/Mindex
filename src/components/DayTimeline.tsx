import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Task } from '../types';
import { categoryColors } from '../lib/taskCategories';
import {
  PlacedTask,
  formatTime,
  parseTime,
  layoutDay,
} from '../lib/timeline';
import PrimeMascot from './PrimeMascot';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

/** Высота одного часа в px по умолчанию. Меняется щипком (pinch-zoom). */
const HOUR_H_DEFAULT = 88;
const HOUR_H_MIN = 40;   // плотно — обзор всего дня
const HOUR_H_MAX = 160;  // воздушно — детально
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
  /** Переключить "ведёт агент" ↔ "обычная задача" — пункт долгого нажатия. */
  onToggleAgent?: (task: Task) => void;
}

/** Состояние поповера контекст-меню долгого нажатия на карточке. */
interface CardMenuState {
  task: Task;
  untimed: boolean;
  x: number;
  y: number;
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
  onToggleAgent,
}: DayTimelineProps) {
  // Высота часа — управляется щипком/Ctrl+колесом. Зум вокруг центра вьюпорта.
  const [hourH, setHourH] = useState(HOUR_H_DEFAULT);

  // Поповер долгого нажатия ("Передать Мысли" / "Сделаю сам" / "Открыть").
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null);

  // Текущее время и дата — обновляем раз в минуту для красной линии и isToday.
  const [now, setNow] = useState(nowMinutes());
  const localDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const [todayStr, setTodayStr] = useState(localDateStr);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(nowMinutes());
      setTodayStr(localDateStr());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const isToday = date === todayStr;

  // Точка отсчёта для авто-раскладки задач без времени: текущее время (сегодня)
  // или 9:00 (прошлые/будущие дни). Округляем вниз до 30 мин, чтобы раскладка не
  // пересчитывалась каждую минуту и чипы не «прыгали» (баг: layout зависел от now).
  const placeFrom = isToday ? Math.floor(now / 30) * 30 : 9 * 60;
  const placed = useMemo(() => layoutDay(tasks, placeFrom), [tasks, placeFrom]);

  // Календарь честный — все 24 часа.
  const startHour = 0;
  const endHour = 24;
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const topOffset = startHour * 60;
  const gridHeight = (endHour - startHour) * hourH;

  const scrollRef = useRef<HTMLDivElement>(null);

  // При смене дня — прокрутить к текущему времени (сегодня) или к первому блоку.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let target: number;
    if (isToday) target = now;
    else if (placed.length) target = Math.min(...placed.map((p) => p.startMin));
    else target = 9 * 60;
    const y = ((target - topOffset) / 60) * hourH - 120;
    el.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const minToY = (min: number) => ((min - topOffset) / 60) * hourH;

  // ─── Pinch-to-zoom (мобиль) + Ctrl/⌘+колесо (десктоп) ──────────────────────
  // hourH держим и в ref, чтобы нативные обработчики (non-passive) видели свежее
  // значение без пересоздания листенера.
  const hourHRef = useRef(hourH);
  hourHRef.current = hourH;
  const pinch = useRef<{ startDist: number; startHourH: number; centerMin: number } | null>(null);

  // Меняет высоту часа, удерживая точку `anchorMin` под тем же экранным Y (зум вокруг точки).
  // `fromHourH` — высота на момент начала жеста (стабильна весь жест, без дрейфа от async-стейта).
  const applyZoom = (nextHourH: number, anchorMin: number, fromHourH: number) => {
    const el = scrollRef.current;
    const clamped = Math.max(HOUR_H_MIN, Math.min(HOUR_H_MAX, nextHourH));
    if (!el) { setHourH(clamped); return; }
    const anchorY = ((anchorMin - topOffset) / 60) * fromHourH;
    const viewportOffset = anchorY - el.scrollTop;
    setHourH(clamped);
    requestAnimationFrame(() => {
      const newAnchorY = ((anchorMin - topOffset) / 60) * clamped;
      el.scrollTop = newAnchorY - viewportOffset;
    });
  };

  // Нативные non-passive обработчики тача для pinch — React-обработчики passive,
  // их preventDefault браузер игнорирует (страница бы зумилась/скроллилась нативно).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist2 = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const rect = el.getBoundingClientRect();
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top + el.scrollTop;
      pinch.current = {
        startDist: dist2(e.touches),
        startHourH: hourHRef.current,
        centerMin: topOffset + (midY / hourHRef.current) * 60,
      };
    };
    const onMove = (e: TouchEvent) => {
      const p = pinch.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault(); // глушим нативный pinch/scroll — теперь работает (non-passive)
      const ratio = dist2(e.touches) / p.startDist;
      applyZoom(p.startHourH * ratio, p.centerMin, p.startHourH);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null;
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topOffset]);

  const handleWheelZoom = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // обычное колесо — скролл; с Ctrl/⌘ — зум
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const anchorMin = topOffset + ((e.clientY - rect.top + el.scrollTop) / hourH) * 60;
    applyZoom(hourH * (e.deltaY < 0 ? 1.1 : 0.9), anchorMin, hourH);
  };

  // Тап по пустому полю → создать задачу, время округляем до ближайших 15 мин.
  // Клик, исходящий из блока (в т.ч. хвост перетаскивания), отсекается closest().
  const handleGridTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-task-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = topOffset + (y / hourH) * 60;
    const rounded = Math.round(min / 15) * 15;
    onCreateAt(formatTime(rounded));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* Градиент сверху — контент плавно уходит под край */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 48, background: 'linear-gradient(to bottom, #ffffff, transparent)', zIndex: 10, pointerEvents: 'none' }} />
      {/* Скроллируемая сетка времени */}
      <div
        ref={scrollRef}
        onWheel={handleWheelZoom}
        className="hide-scrollbar"
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', touchAction: 'pan-y' }}
      >
        <div
          onClick={handleGridTap}
          style={{ position: 'relative', height: gridHeight, margin: '0 20px 120px' }}
        >
          {/* Часовые линии и подписи */}
          {hours.map((h) => {
            const y = (h * 60 - topOffset) / 60 * hourH;
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
              height={Math.max(p.untimed ? 30 : 34, ((p.endMin - p.startMin) / 60) * hourH - 4)}
              hourH={hourH}
              minStart={topOffset}
              maxEnd={endHour * 60}
              onClick={() => (p.untimed ? onUntimedClick(p.task) : onTaskClick(p.task))}
              onMove={onTaskMove}
              onLongPress={onToggleAgent ? (x, y) => setCardMenu({ task: p.task, untimed: p.untimed, x, y }) : undefined}
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

      {/* Контекст-меню долгого нажатия: "Передать Мысли"/"Сделаю сам" + "Открыть" */}
      <AnimatePresence>
        {cardMenu && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 998 }}
            onClick={() => setCardMenu(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: Math.min(cardMenu.x, window.innerWidth - 200),
                top: Math.min(cardMenu.y, window.innerHeight - 140),
                zIndex: 999,
                background: '#fff',
                borderRadius: 14,
                boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                overflow: 'hidden',
                minWidth: 180,
              }}
            >
              {onToggleAgent && (
                <button
                  onClick={() => { onToggleAgent(cardMenu.task); setCardMenu(null); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: M, fontSize: 14, color: '#222224',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                  }}
                >
                  {cardMenu.task.agent ? 'Сделаю сам' : 'Передать Мысли'}
                </button>
              )}
              <button
                onClick={() => {
                  const t = cardMenu.task;
                  const untimed = cardMenu.untimed;
                  setCardMenu(null);
                  untimed ? onUntimedClick(t) : onTaskClick(t);
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: M, fontSize: 14, color: '#222224',
                }}
              >
                Открыть
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Метка источника «пришло из Telegram» — нейтральный кружок-самолётик,
 * показывается только когда у задачи нет agent-лица (иначе приоритет у лица).
 */
function TelegramMark() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      fill="none"
      style={{ flexShrink: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <circle cx={9} cy={9} r={8.2} stroke="rgba(34,34,36,0.35)" strokeWidth={1.4} fill="none" />
      <path
        d="M5 9.3l7-3.4-2.6 7.6-1.4-2.6-2.9-1.1z"
        fill="rgba(34,34,36,0.35)"
      />
    </svg>
  );
}

/** Долгое нажатие БЕЗ движения дольше этого порога → контекст-меню (отменяет drag). */
const LONG_PRESS_MENU_MS = 450;
/** Смещение по Y (px), после которого нажатие считается перетаскиванием, а не долгим тапом. */
const MENU_MOVE_TOLERANCE = 6;

function TimelineBlock({
  placed,
  top,
  height,
  hourH,
  minStart,
  maxEnd,
  onClick,
  onMove,
  onLongPress,
}: {
  placed: PlacedTask;
  top: number;
  height: number;
  hourH: number;
  minStart: number;
  maxEnd: number;
  onClick: () => void;
  onMove?: (taskId: string, time: string, endTime: string) => void;
  /** Долгое нажатие без движения → координаты тапа для контекст-меню (см. DayTimeline). */
  onLongPress?: (clientX: number, clientY: number) => void;
}) {
  const { task, startMin, endMin, col, cols, untimed } = placed;
  const colors = categoryColors(task.category);
  const duration = endMin - startMin;

  // Смещение по Y во время перетаскивания (px). null — не тащим.
  // dragDy — для рендера; dyRef — свежее значение для finishDrag (не зависит от async-стейта).
  const [dragDy, setDragDy] = useState<number | null>(null);
  const dyRef = useRef(0);
  const drag = useRef<{
    startY: number;
    active: boolean;
    longPressId: ReturnType<typeof setTimeout> | null;
    menuTimerId: ReturnType<typeof setTimeout> | null;
    pointerId: number;
  } | null>(null);
  // Гасит click, который браузер генерит сразу после pointerup завершившегося drag.
  const suppressClick = useRef(false);
  const blockRef = useRef<HTMLDivElement>(null);

  // Нативный non-passive touchmove: React-обработчики passive, их preventDefault
  // браузер игнорирует. Тут глушим скролл, пока активен drag по блоку.
  useEffect(() => {
    const el = blockRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

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

  const compact = untimed || height < 52;
  const draggable = !!onMove;

  // Активен ли drag прямо сейчас (для переключения touch-action: пока не тащим — pan-y
  // отдаёт вертикальный скролл; как только long-press сработал — none, чтобы браузер
  // не перехватывал движение пальца под скролл).
  const [dragActive, setDragActive] = useState(false);

  const beginDrag = (clientX: number, clientY: number, pointerId: number, el: HTMLElement, immediate: boolean) => {
    // Захватываем pointer сразу — иначе на тач браузер заберёт события под скролл.
    try { el.setPointerCapture(pointerId); } catch {}
    const startDrag = () => {
      if (!drag.current) return;
      drag.current.active = true;
      dyRef.current = 0;
      setDragActive(true);
      setDragDy(0);
    };
    drag.current = { startY: clientY, active: false, longPressId: null, menuTimerId: null, pointerId };
    // Перетаскивание доступно только когда передан onMove — карточка без него (напр.,
    // при отключённом drag) всё равно должна ловить долгое нажатие для меню ниже.
    if (draggable) {
      if (immediate) startDrag();
      else drag.current.longPressId = setTimeout(startDrag, 200); // long-press на тач
    }

    // Долгое нажатие БЕЗ движения дольше LONG_PRESS_MENU_MS → контекст-меню, отменяем drag.
    // Если за это время пользователь начал реально двигать блок — это обычный drag,
    // меню не показываем (проверяем накопленное смещение dyRef на момент срабатывания).
    if (onLongPress) {
      drag.current.menuTimerId = setTimeout(() => {
        const cur = drag.current;
        if (!cur || Math.abs(dyRef.current) > MENU_MOVE_TOLERANCE) return;
        if (cur.longPressId) clearTimeout(cur.longPressId);
        try { el.releasePointerCapture(cur.pointerId); } catch {}
        drag.current = null;
        setDragDy(null);
        setDragActive(false);
        suppressClick.current = true; // это было долгое нажатие, не тап — гасим следующий click
        onLongPress(clientX, clientY);
      }, LONG_PRESS_MENU_MS);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable && !onLongPress) return;
    // Мышь/перо — тащим сразу; палец — через long-press, чтобы не мешать скроллу.
    beginDrag(e.clientX, e.clientY, e.pointerId, e.currentTarget, e.pointerType !== 'touch');
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // До срабатывания long-press: заметное вертикальное движение = пользователь скроллит,
    // отменяем подготовку drag и отпускаем pointer обратно скроллу.
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) > 10) {
        if (d.longPressId) clearTimeout(d.longPressId);
        if (d.menuTimerId) clearTimeout(d.menuTimerId);
        try { e.currentTarget.releasePointerCapture(d.pointerId); } catch {}
        drag.current = null;
      }
      return;
    }
    e.preventDefault();
    const dy = e.clientY - d.startY;
    dyRef.current = dy;
    setDragDy(dy);
  };

  const finishDrag = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    if (d.longPressId) clearTimeout(d.longPressId);
    if (d.menuTimerId) clearTimeout(d.menuTimerId);
    if (d.active) {
      const deltaMin = Math.round(dyRef.current / pxPerMin / SNAP_MIN) * SNAP_MIN;
      let newStart = startMin + deltaMin;
      // Не выпускаем за границы видимого диапазона.
      newStart = Math.max(minStart, Math.min(maxEnd - duration, newStart));
      const moved = newStart !== startMin;
      // Гасим следующий click ТОЛЬКО если блок реально сдвинулся. Просто долгое
      // удержание без перемещения должно открыть детали как обычный тап.
      if (moved) suppressClick.current = true;
      if (commit && onMove && moved) {
        onMove(task.id, formatTime(newStart), formatTime(newStart + duration));
      }
    }
    drag.current = null;
    setDragDy(null);
    setDragActive(false);
  };

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onClick();
  };

  const isDragging = dragDy !== null;

  return (
    <motion.div
      ref={blockRef}
      data-task-block
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(true)}
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
        // Тонкие чипы центрируем (текст в одну строку); обычные блоки — по верхнему краю,
        // иначе у высоких блоков (3+ часа) заголовок уезжает в середину.
        justifyContent: (untimed || compact) ? 'center' : 'flex-start',
        gap: 2,
        overflow: 'hidden',
        cursor: draggable ? 'grab' : 'pointer',
        opacity: task.done ? 0.55 : 1,
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
        zIndex: isDragging ? 20 : 1,
        // Пока не тащим — pan-y отдаёт вертикальный скролл; при активном drag — none,
        // чтобы браузер не перехватывал движение пальца под прокрутку.
        touchAction: dragActive ? 'none' : 'pan-y',
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
      {/* Слот-иконка: лицо агента (приоритет) или метка источника Telegram + название,
          в одну горизонтальную строку — иконка не сжимается, текст обрезается ellipsis. */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {task.agent && (
          <div style={{ flexShrink: 0, pointerEvents: 'none' }}>
            <PrimeMascot
              size={18}
              eyes="idle"
              decor="none"
              drop={task.agent}
            />
          </div>
        )}
        {!task.agent && task.origin === 'telegram' && <TelegramMark />}
        {task.scheduleId && (
          <span
            title="Повторяется по расписанию"
            style={{ flexShrink: 0, fontSize: 12, lineHeight: 1, opacity: 0.75, pointerEvents: 'none' }}
          >
            🔁
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
            minWidth: 0,
          }}
        >
          {task.name}
        </span>
      </div>
    </motion.div>
  );
}
