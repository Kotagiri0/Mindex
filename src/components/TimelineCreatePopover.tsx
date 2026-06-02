import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { formatTime, parseTime, DEFAULT_DURATION_MIN } from '../lib/timeline';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

interface Props {
  /** Время начала ("HH:MM"), по которому тапнули. */
  startTime: string;
  onCancel: () => void;
  onCreate: (name: string, time: string, endTime: string) => void;
}

/**
 * Лёгкое мини-меню создания задачи тапом по таймлайну (ТЗ п.7):
 * название + время начала/окончания (дефолт +1ч). Без лишних полей —
 * категорию и детали человек докрутит позже, либо проставит агент.
 */
export default function TimelineCreatePopover({ startTime, onCancel, onCreate }: Props) {
  const defaultEnd = formatTime((parseTime(startTime) ?? 0) + DEFAULT_DURATION_MIN);
  const [name, setName] = useState('');
  const [start, setStart] = useState(startTime);
  const [end, setEnd] = useState(defaultEnd);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Автофокус на названии — главное, что нужно ввести.
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const submit = () => {
    if (!name.trim()) return;
    // Гарантируем, что конец позже начала — иначе сбрасываем на +1ч.
    const s = parseTime(start) ?? 0;
    const e = parseTime(end);
    const safeEnd = e !== null && e > s ? end : formatTime(s + DEFAULT_DURATION_MIN);
    onCreate(name, start, safeEnd);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative w-full bg-surface rounded-t-[22px]"
        style={{ padding: '18px 18px calc(28px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />

        <h3 className="text-[17px] font-bold mb-3.5" style={{ fontFamily: M }}>Новая задача</h3>

        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Что нужно сделать?"
          className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary mb-3"
          style={{ fontFamily: M }}
        />

        <div className="flex gap-2.5 mb-4">
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Начало</label>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Конец</label>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!name.trim()}
          className="w-full h-[48px] bg-accent text-white rounded-[12px] font-bold text-[15px] active:opacity-85 transition-opacity disabled:opacity-40"
        >
          Создать
        </button>
      </motion.div>
    </div>
  );
}
