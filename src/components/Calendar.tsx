import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CalendarProps {
  initialDate?: string;
  onSelectDate?: (date: string) => void;
  onBack?: () => void;
  className?: string;
}

type SwipeDirection = 1 | -1;

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const FONT_FAMILY = "'Random Grotesque', sans-serif";

const SPRING = { type: 'spring' as const, stiffness: 340, damping: 34, mass: 0.9 };

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

  return Array.from({ length: totalDays }, (_, index) =>
    new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index)
  );
};

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

export default function Calendar({ initialDate, onSelectDate, onBack, className }: CalendarProps) {
  const todayDate = new Date();
  const today = dateKey(todayDate);

  const [selectedDate, setSelectedDate] = useState(initialDate || today);
  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(parseDate(initialDate || today) || todayDate));
  const [direction, setDirection] = useState<SwipeDirection>(1);

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!initialDate) return;
    setSelectedDate(initialDate);
    const parsed = parseDate(initialDate);
    if (parsed) setDisplayMonth(startOfMonth(parsed));
  }, [initialDate]);

  const selectedDateObj = useMemo(() => parseDate(selectedDate), [selectedDate]);
  const monthGrid = useMemo(() => buildMonthGrid(displayMonth), [displayMonth]);
  const rowClass = monthGrid.length === 42 ? 'grid-rows-6' : 'grid-rows-5';

  const commitSelection = (date: Date) => {
    const key = dateKey(date);
    setSelectedDate(key);
    onSelectDate?.(key);
  };

  const slideToMonth = (delta: SwipeDirection) => {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => { busy.current = false; }, 420);

    const nextMonth = addMonths(displayMonth, delta);
    setDirection(delta);
    setDisplayMonth(nextMonth);

    if (selectedDateObj) {
      const boundedDay = Math.min(
        selectedDateObj.getDate(),
        new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate()
      );
      commitSelection(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), boundedDay));
    }
  };

  const goToday = () => {
    if (busy.current) return;
    const monthStart = startOfMonth(todayDate);
    const isSameMonth =
      monthStart.getFullYear() === displayMonth.getFullYear() &&
      monthStart.getMonth() === displayMonth.getMonth();

    if (!isSameMonth) {
      setDirection(monthStart > displayMonth ? 1 : -1);
      busy.current = true;
      setTimeout(() => { busy.current = false; }, 420);
      setDisplayMonth(monthStart);
    }
    commitSelection(todayDate);
  };

  const handleDragStart = (x: number, y: number) => {
    dragStart.current = { x, y };
    dragging.current = true;
  };

  const handleDragEnd = (x: number, y: number) => {
    if (!dragging.current || busy.current || !dragStart.current) return;
    const dx = x - dragStart.current.x;
    const dy = y - dragStart.current.y;
    dragging.current = false;
    dragStart.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    slideToMonth(dx < 0 ? 1 : -1);
  };

  const slideX = direction === 1 ? '28%' : '-28%';

  return (
    <div className={`w-full ${className || ''}`} style={{ fontFamily: FONT_FAMILY }}>
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-1">
          {onBack && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.88 }}
              aria-label="Back"
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center rounded-full"
            >
              <ChevronLeft size={20} strokeWidth={1.75} color="#222224" />
            </motion.button>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.88 }}
            aria-label="Previous month"
            onClick={() => slideToMonth(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-full"
          >
            <ChevronLeft size={20} strokeWidth={1.75} color="#222224" />
          </motion.button>
        </div>

        {/* Month title — animates on change */}
        <div className="relative flex flex-col items-center overflow-hidden" style={{ minWidth: 100 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.button
              key={monthKey(displayMonth)}
              type="button"
              aria-label="Today"
              onClick={goToday}
              initial={{ opacity: 0, y: direction === 1 ? 10 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: direction === 1 ? -10 : 10 }}
              transition={{ duration: 0.22, ease: [0.32, 0, 0.16, 1] }}
              className="flex flex-col items-center"
            >
              <span className="text-[11px] uppercase tracking-[0.08em] text-[rgba(34,34,36,0.4)]">
                {displayMonth.getFullYear()}
              </span>
              <span className="text-[20px] leading-none text-[#222224]">
                {MONTHS[displayMonth.getMonth()]}
              </span>
            </motion.button>
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.88 }}
          aria-label="Next month"
          onClick={() => slideToMonth(1)}
          className="w-9 h-9 flex items-center justify-center rounded-full"
        >
          <ChevronRight size={20} strokeWidth={1.75} color="#222224" />
        </motion.button>
      </div>

      {/* Grid */}
      <div
        className="relative overflow-hidden rounded-[24px] bg-white px-3 pb-4 pt-3 shadow-[0_1px_0_rgba(34,34,36,0.04)] min-h-[316px]"
        style={{ touchAction: 'none' }}
        onTouchStart={(e) => handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={(e) => handleDragEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
        onTouchCancel={() => { dragging.current = false; dragStart.current = null; }}
        onPointerDown={(e) => { if (e.pointerType !== 'touch') handleDragStart(e.clientX, e.clientY); }}
        onPointerUp={(e) => { if (e.pointerType !== 'touch') handleDragEnd(e.clientX, e.clientY); }}
      >
        {/* Weekday labels — static */}
        <div className="grid grid-cols-7 gap-y-2 text-center text-[11px] uppercase tracking-[0.08em] text-[rgba(34,34,36,0.38)]">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-1">{day}</div>
          ))}
        </div>

        {/* Days — spring slide + fade */}
        <div className="relative mt-1" style={{ minHeight: monthGrid.length === 42 ? 276 : 230 }}>
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={monthKey(displayMonth)}
              className={`grid grid-cols-7 ${rowClass} gap-1`}
              custom={direction}
              initial={{ x: slideX, opacity: 0 }}
              animate={{ x: '0%', opacity: 1 }}
              exit={{ x: direction === 1 ? '-28%' : '28%', opacity: 0 }}
              transition={SPRING}
              style={{ willChange: 'transform' }}
            >
              {monthGrid.map((date) => {
                const key = dateKey(date);
                const isInMonth = date.getMonth() === displayMonth.getMonth();
                const isToday = key === today;
                const isSelected = key === selectedDate;

                return (
                  <motion.button
                    key={key}
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    onClick={() => commitSelection(date)}
                    aria-label={date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    aria-pressed={isSelected}
                    className={[
                      'relative flex aspect-square items-center justify-center rounded-[14px] text-[16px]',
                      isInMonth ? 'text-[#222224]' : 'text-[rgba(34,34,36,0.28)]',
                      isSelected
                        ? 'bg-[#222224] text-white shadow-[0_6px_16px_rgba(34,34,36,0.14)]'
                        : 'hover:bg-[rgba(34,34,36,0.04)]',
                      isToday && !isSelected ? 'ring-1 ring-[rgba(34,34,36,0.14)]' : '',
                    ].join(' ')}
                    style={{ transition: 'background-color 0.15s, color 0.15s, box-shadow 0.15s' }}
                  >
                    <span className={isSelected ? 'font-semibold' : 'font-normal'}>{date.getDate()}</span>
                    {isToday && !isSelected && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#222224]" />
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
