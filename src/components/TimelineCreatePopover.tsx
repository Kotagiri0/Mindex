import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { formatTime, parseTime, DEFAULT_DURATION_MIN } from '../lib/timeline';
import { useSquircle } from '../hooks/useSquircle';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { TaskCategory } from '../types';
import { CATEGORY_COLORS, CATEGORY_LABELS, ORDERED_CATEGORIES } from '../lib/taskCategories';

const taskTimeIcon = `data:image/svg+xml,%3Csvg width='55' height='55' viewBox='0 0 55 55' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M27.5 2.75C41.169 2.75 52.25 13.831 52.25 27.5C52.25 41.169 41.169 52.25 27.5 52.25C13.831 52.25 2.75 41.169 2.75 27.5C2.75 13.831 13.831 2.75 27.5 2.75Z' stroke='%237E7F80' stroke-width='5.5'/%3E%3Cpath d='M27.5 15.7812L27.5 28.0035' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round'/%3E%3Cpath d='M27.5 28.6094L37.2216 38.331' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round'/%3E%3C/svg%3E`;
const taskDateIcon = `data:image/svg+xml,%3Csvg width='50' height='56' viewBox='0 0 50 56' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M34.375 0C35.8938 2.06051e-08 37.125 1.23122 37.125 2.75V6.74414C44.0268 8.60239 49.1073 14.9039 49.1074 22.3926V39.0889L49.1016 39.5078C48.8829 48.1251 41.9376 55.0706 33.3203 55.2891L32.9014 55.2949H16.2051L15.7871 55.2891C7.0306 55.0672 0.000257744 47.8988 0 39.0889V22.3926C0.000117721 15.0824 4.84063 8.90273 11.4912 6.88379V2.75C11.4912 1.23122 12.7224 5.61746e-08 14.2412 0C15.7599 7.52798e-05 16.9912 1.23126 16.9912 2.75V6.1875H31.625V2.75C31.625 1.23122 32.8562 5.61746e-08 34.375 0ZM5.5 39.0889C5.50026 45.001 10.293 49.7948 16.2051 49.7949H32.9014C38.8136 49.7949 43.6072 45.001 43.6074 39.0889V23.1777H5.5V39.0889ZM16.2051 11.6875C11.9849 11.6876 8.33625 14.1297 6.59277 17.6777H42.5146C40.7709 14.1296 37.1217 11.6875 32.9014 11.6875H16.2051Z' fill='%237E7F80'/%3E%3C/svg%3E`;
const taskPlaceIcon = `data:image/svg+xml,%3Csvg width='45' height='55' viewBox='0 0 45 55' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.75 21.865C2.75 35.2617 14.4696 46.3401 19.6571 50.5875C20.3995 51.1954 20.7751 51.503 21.329 51.6589C21.7603 51.7804 22.395 51.7804 22.8263 51.6589C23.3812 51.5027 23.7543 51.1981 24.4995 50.588C29.6869 46.3405 41.4059 35.2629 41.4059 21.8663C41.4059 16.7965 39.3697 11.9337 35.745 8.34885C32.1202 4.76397 27.2044 2.75 22.0783 2.75C16.9522 2.75 12.0358 4.76427 8.41106 8.34915C4.78634 11.934 2.75 16.7953 2.75 21.865Z' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M15.5786 20.7098C15.5786 24.3238 18.5621 27.2536 22.2424 27.2536C25.9227 27.2536 28.9061 24.3238 28.9061 20.7098C28.9061 17.0958 25.9227 14.166 22.2424 14.166C18.5621 14.166 15.5786 17.0958 15.5786 20.7098Z' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const CIRCLE_H = 36;
const PILL_H = 52;

interface Props {
  startTime: string;
  onCancel: () => void;
  onCreate: (name: string, time: string, endTime: string, category?: TaskCategory) => void;
}

export default function TimelineCreatePopover({ startTime, onCancel, onCreate }: Props) {
  const defaultEnd = formatTime((parseTime(startTime) ?? 0) + DEFAULT_DURATION_MIN);
  const [name, setName] = useState('');
  const [start, setStart] = useState(startTime);
  const [end, setEnd] = useState(defaultEnd);
  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<TaskCategory>('none');
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref: squircleRef, clipPath } = useSquircle({ cornerRadius: 36, cornerSmoothing: 0.6 });
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const submit = () => {
    if (!name.trim()) return;
    const s = parseTime(start) ?? 0;
    const e = parseTime(end);
    const safeEnd = e !== null && e > s ? end : formatTime(s + DEFAULT_DURATION_MIN);
    onCreate(name, start, safeEnd, category);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end" style={{ paddingBottom: keyboardInset, transition: 'padding-bottom 0.2s ease-out' }}>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <motion.div
        ref={squircleRef}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{
          position: 'relative', width: '100%', background: '#ffffff',
          clipPath: clipPath || undefined,
          borderRadius: clipPath ? 0 : '36px 36px 0 0',
          padding: '18px 23px 0',
          marginBottom: -50,
          paddingBottom: 50,
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'rgba(34,34,36,0.12)', borderRadius: 2, margin: '0 auto 20px' }} />

        {/* Title */}
        <h3 style={{ fontFamily: M, fontSize: 20, fontWeight: 500, color: '#0B0D10', textAlign: 'center', marginBottom: 20 }}>
          Новое событие
        </h3>

        {/* Name field */}
        <FieldBox style={{ marginBottom: 17 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Что на повестке дня?"
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={inputStyle(!!name)}
          />
        </FieldBox>

        {/* Time row */}
        <div style={{ display: 'flex', gap: 13, marginBottom: 17 }}>
          <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              value={start}
              onChange={(e) => setStart(formatTimeInput(e.target.value))}
              placeholder="00:00"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={5}
              style={nativeTimeStyle(isCompleteTime(start))}
            />
            <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
          </FieldBox>
          <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              value={end}
              onChange={(e) => setEnd(formatTimeInput(e.target.value))}
              placeholder="00:00"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={5}
              style={nativeTimeStyle(isCompleteTime(end))}
            />
            <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
          </FieldBox>
        </div>

        {/* Expanded fields */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', damping: 32, stiffness: 340 }}
              style={{ overflow: 'hidden' }}
            >
              {/* Date */}
              <FieldBox style={{ marginBottom: 17, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={nativeTimeStyle(!!date)}
                />
                <img src={taskDateIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
              </FieldBox>

              {/* Location */}
              <FieldBox style={{ marginBottom: 17, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Где будет проходить?"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  style={{ ...inputStyle(!!location), flex: 1 }}
                />
                <img src={taskPlaceIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
              </FieldBox>

              {/* Category */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: PILL_H, marginBottom: 17 }}>
                {ORDERED_CATEGORIES.map((cat) => {
                  const c = CATEGORY_COLORS[cat];
                  const active = category === cat;
                  return (
                    <motion.button
                      key={cat}
                      layout
                      onClick={() => setCategory(cat)}
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      style={{
                        background: c.bg, border: 'none', borderRadius: 999, cursor: 'pointer',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0,
                      }}
                      animate={{ width: active ? 140 : CIRCLE_H, height: active ? PILL_H : CIRCLE_H }}
                    >
                      <AnimatePresence mode="wait">
                        {active ? (
                          <motion.div
                            key="label"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pointerEvents: 'none' }}
                          >
                            <span style={{ fontFamily: M, fontSize: 11, fontWeight: 400, color: c.textMuted, lineHeight: 1.2 }}>категория</span>
                            <span style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: c.text, whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                              {CATEGORY_LABELS[cat].toLowerCase()}
                            </span>
                          </motion.div>
                        ) : (
                          <motion.div key="dot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} />
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expand toggle arrow */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 17 }}>
          <motion.button
            onClick={() => setExpanded(v => !v)}
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 16px', display: 'flex', alignItems: 'center' }}
          >
            <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
              <path d="M2 14 L14 3 L26 14" stroke="rgba(11,13,16,0.2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        </div>

        {/* Add button */}
        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: '100%', height: 52,
            background: name.trim() ? '#0B0D10' : 'rgba(11,13,16,0.18)',
            color: '#ffffff', border: 'none', borderRadius: 999,
            fontFamily: M, fontSize: 16, fontWeight: 700,
            cursor: name.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s',
          }}
        >
          Добавить
        </button>

        <div style={{ height: 'max(20px, env(safe-area-inset-bottom, 20px))' }} />
      </motion.div>
    </div>
  );
}

function FieldBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ position: 'relative', background: '#f5f5f5', borderRadius: 20, padding: '14px 17px', ...style }}>
      {children}
    </div>
  );
}

const inputStyle = (hasValue: boolean): React.CSSProperties => ({
  width: '100%', border: 'none', outline: 'none', background: 'transparent',
  fontFamily: M, fontSize: 15,
  fontWeight: hasValue ? 500 : 400,
  color: hasValue ? '#0B0D10' : 'rgba(11,13,16,0.3)',
});

const nativeTimeStyle = (hasValue: boolean): React.CSSProperties => ({
  flex: 1, border: 'none', outline: 'none', background: 'transparent',
  fontFamily: M, fontSize: 15,
  fontWeight: hasValue ? 500 : 400,
  color: hasValue ? '#0B0D10' : 'rgba(11,13,16,0.3)',
  WebkitAppearance: 'none',
  appearance: 'none' as any,
  minWidth: 0,
});

// Форматирует сырой ввод пользователя в HH:MM по мере набора
function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

function isCompleteTime(val: string): boolean {
  return /^\d{2}:\d{2}$/.test(val);
}
