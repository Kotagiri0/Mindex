import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarProps {
  initialDate?: string;
  onSelectDate?: (date: string) => void;
  onBack?: () => void;
  className?: string;
}

type SlidePhase = 'idle' | 'pre' | 'animating';
type SwipeDirection = 1 | -1;

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const FONT_FAMILY = "'Random Grotesque', sans-serif";
const TRANSITION_MS = 250;

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date: Date, delta: number) => new Date(date.getFullYear(), date.getMonth() + delta, 1);

const buildMonthGrid = (monthDate: Date) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startOffset = (firstDay.getDay() + 6) % 7;
  const endOffset = 6 - ((lastDay.getDay() + 6) % 7);
  const totalDays = Math.max(35, lastDay.getDate() + startOffset + endOffset);
  const startDate = new Date(year, month, 1 - startOffset);

  return Array.from({ length: totalDays }, (_, index) => new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index));
};

export default function Calendar({ initialDate, onSelectDate, onBack, className }: CalendarProps) {
  const todayDate = new Date();
  const today = dateKey(todayDate);

  const [selectedDate, setSelectedDate] = useState(initialDate || today);
  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(parseDate(initialDate || today) || todayDate));
  const [incomingMonth, setIncomingMonth] = useState<Date | null>(null);
  const [direction, setDirection] = useState<SwipeDirection>(1);
  const [phase, setPhase] = useState<SlidePhase>('idle');

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!initialDate) return;
    setSelectedDate(initialDate);
    const parsed = parseDate(initialDate);
    if (parsed) setDisplayMonth(startOfMonth(parsed));
  }, [initialDate]);

  useEffect(() => {
    if (phase !== 'pre') return;
    const frame = requestAnimationFrame(() => setPhase('animating'));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'animating' || !incomingMonth) return;
    const timeout = window.setTimeout(() => {
      setDisplayMonth(incomingMonth);
      setIncomingMonth(null);
      setPhase('idle');
    }, TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [phase, incomingMonth]);

  const selectedDateObj = useMemo(() => parseDate(selectedDate), [selectedDate]);
  const monthGrid = useMemo(() => buildMonthGrid(displayMonth), [displayMonth]);
  const incomingGrid = useMemo(() => (incomingMonth ? buildMonthGrid(incomingMonth) : null), [incomingMonth]);
  const rowClass = monthGrid.length === 42 ? 'grid-rows-6' : 'grid-rows-5';
  const incomingRowClass = incomingGrid?.length === 42 ? 'grid-rows-6' : 'grid-rows-5';

  const commitSelection = (date: Date) => {
    const key = dateKey(date);
    setSelectedDate(key);
    onSelectDate?.(key);
  };

  const slideToMonth = (delta: SwipeDirection) => {
    if (phase !== 'idle') return;

    const nextMonth = addMonths(displayMonth, delta);
    setDirection(delta);
    setIncomingMonth(nextMonth);
    setPhase('pre');

    if (selectedDateObj) {
      const boundedDay = Math.min(selectedDateObj.getDate(), new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate());
      commitSelection(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), boundedDay));
    }
  };

  const goToday = () => {
    if (phase !== 'idle') return;
    const monthStart = startOfMonth(todayDate);
    const isSameMonth = monthStart.getFullYear() === displayMonth.getFullYear() && monthStart.getMonth() === displayMonth.getMonth();

    if (!isSameMonth) {
      setDirection(monthStart > displayMonth ? 1 : -1);
      setIncomingMonth(monthStart);
      setPhase('pre');
    }
    commitSelection(todayDate);
  };

  const swipeSupported = typeof window !== 'undefined'
    ? window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 1024 || navigator.maxTouchPoints > 0
    : false;

  const handleDragStart = (x: number, y: number) => {
    if (!swipeSupported) return;
    dragStart.current = { x, y };
    dragging.current = true;
  };

  const handleDragEnd = (x: number, y: number) => {
    if (!dragging.current || phase !== 'idle' || !dragStart.current) return;
    const dx = x - dragStart.current.x;
    const dy = y - dragStart.current.y;

    dragging.current = false;
    dragStart.current = null;

    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) slideToMonth(1);
    else slideToMonth(-1);
  };

  const paneStyle = (pane: 'current' | 'incoming') => {
    const isAnimating = phase === 'animating';
    const isPre = phase === 'pre';

    let transform = 'translateX(0%)';

    if (pane === 'current' && isAnimating) {
      transform = direction === 1 ? 'translateX(-100%)' : 'translateX(100%)';
    }

    if (pane === 'incoming' && incomingMonth) {
      if (isPre) transform = direction === 1 ? 'translateX(100%)' : 'translateX(-100%)';
      if (isAnimating) transform = 'translateX(0%)';
    }

    return {
      transform,
      transition: isAnimating ? `transform ${TRANSITION_MS}ms ease-in-out` : 'none',
    } as React.CSSProperties;
  };

  return (
    <div className={`w-full ${className || ''}`} style={{ fontFamily: FONT_FAMILY }}>
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-1">
          {onBack && (
            <button
              type="button"
              aria-label="Back to dashboard"
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition-transform"
            >
              <ChevronLeft size={20} strokeWidth={1.75} color="#222224" />
            </button>
          )}
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => slideToMonth(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition-transform"
          >
            <ChevronLeft size={20} strokeWidth={1.75} color="#222224" />
          </button>
        </div>

        <button
          type="button"
          aria-label="Today"
          onClick={goToday}
          className="flex flex-col items-center active:scale-95 transition-transform"
        >
          <span className="text-[11px] uppercase tracking-[0.08em] text-[rgba(34,34,36,0.4)]">{displayMonth.getFullYear()}</span>
          <span className="text-[20px] leading-none text-[#222224]">{MONTHS[displayMonth.getMonth()]}</span>
        </button>

        <button
          type="button"
          aria-label="Next month"
          onClick={() => slideToMonth(1)}
          className="w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition-transform"
        >
          <ChevronRight size={20} strokeWidth={1.75} color="#222224" />
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-[24px] bg-white px-3 pb-4 pt-3 shadow-[0_1px_0_rgba(34,34,36,0.04)] min-h-[316px]"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={(event) => handleDragStart(event.touches[0].clientX, event.touches[0].clientY)}
        onTouchEnd={(event) => handleDragEnd(event.changedTouches[0].clientX, event.changedTouches[0].clientY)}
        onMouseDown={(event) => {
          if (!swipeSupported) return;
          handleDragStart(event.clientX, event.clientY);
        }}
        onMouseUp={(event) => {
          if (!swipeSupported) return;
          handleDragEnd(event.clientX, event.clientY);
        }}
      >
        <div className="grid grid-cols-7 gap-y-2 text-center text-[11px] uppercase tracking-[0.08em] text-[rgba(34,34,36,0.38)]">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-1">{day}</div>
          ))}
        </div>

        <div className="relative mt-1">
          <div className={`grid grid-cols-7 ${rowClass} gap-1`} style={paneStyle('current')}>
            {monthGrid.map((date) => {
              const key = dateKey(date);
              const isInMonth = date.getMonth() === displayMonth.getMonth();
              const isToday = key === today;
              const isSelected = key === selectedDate;

              return (
                <button
                  key={`current-${key}`}
                  type="button"
                  onClick={() => commitSelection(date)}
                  aria-label={`Select ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  aria-pressed={isSelected}
                  className={[
                    'relative flex aspect-square items-center justify-center rounded-[14px] text-[16px] transition-[transform,background-color,color,box-shadow] duration-200 active:scale-[0.96]',
                    isInMonth ? 'text-[#222224]' : 'text-[rgba(34,34,36,0.34)]',
                    isSelected ? 'bg-[#222224] text-white shadow-[0_8px_20px_rgba(34,34,36,0.12)]' : 'hover:bg-[rgba(34,34,36,0.04)]',
                    isToday && !isSelected ? 'ring-1 ring-[rgba(34,34,36,0.14)]' : '',
                  ].join(' ')}
                >
                  <span className={isSelected ? 'font-semibold' : 'font-normal'}>{date.getDate()}</span>
                  {isToday && !isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#222224]" />}
                </button>
              );
            })}
          </div>

          {incomingMonth && incomingGrid && (
            <div className={`absolute inset-0 grid grid-cols-7 ${incomingRowClass} gap-1`} style={paneStyle('incoming')}>
              {incomingGrid.map((date) => {
                const key = dateKey(date);
                const isInMonth = date.getMonth() === incomingMonth.getMonth();
                const isToday = key === today;
                const isSelected = key === selectedDate;

                return (
                  <button
                    key={`incoming-${key}`}
                    type="button"
                    onClick={() => commitSelection(date)}
                    aria-label={`Select ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                    aria-pressed={isSelected}
                    className={[
                      'relative flex aspect-square items-center justify-center rounded-[14px] text-[16px] transition-[transform,background-color,color,box-shadow] duration-200 active:scale-[0.96]',
                      isInMonth ? 'text-[#222224]' : 'text-[rgba(34,34,36,0.34)]',
                      isSelected ? 'bg-[#222224] text-white shadow-[0_8px_20px_rgba(34,34,36,0.12)]' : 'hover:bg-[rgba(34,34,36,0.04)]',
                      isToday && !isSelected ? 'ring-1 ring-[rgba(34,34,36,0.14)]' : '',
                    ].join(' ')}
                  >
                    <span className={isSelected ? 'font-semibold' : 'font-normal'}>{date.getDate()}</span>
                    {isToday && !isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#222224]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}