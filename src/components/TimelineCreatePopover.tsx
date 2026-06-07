import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { formatTime, parseTime, DEFAULT_DURATION_MIN } from '../lib/timeline';
import { useSquircle } from '../hooks/useSquircle';
const taskTimeIcon = `data:image/svg+xml,%3Csvg width='55' height='55' viewBox='0 0 55 55' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M27.5 2.75C41.169 2.75 52.25 13.831 52.25 27.5C52.25 41.169 41.169 52.25 27.5 52.25C13.831 52.25 2.75 41.169 2.75 27.5C2.75 13.831 13.831 2.75 27.5 2.75Z' stroke='%237E7F80' stroke-width='5.5'/%3E%3Cpath d='M27.5 15.7812L27.5 28.0035' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round'/%3E%3Cpath d='M27.5 28.6094L37.2216 38.331' stroke='%237E7F80' stroke-width='5.5' stroke-linecap='round'/%3E%3C/svg%3E`;

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";

interface Props {
  startTime: string;
  onCancel: () => void;
  onCreate: (name: string, time: string, endTime: string) => void;
}

export default function TimelineCreatePopover({ startTime, onCancel, onCreate }: Props) {
  const defaultEnd = formatTime((parseTime(startTime) ?? 0) + DEFAULT_DURATION_MIN);
  const [name, setName] = useState('');
  const [start, setStart] = useState(startTime);
  const [end, setEnd] = useState(defaultEnd);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref: squircleRef, clipPath } = useSquircle({ cornerRadius: 36, cornerSmoothing: 0.6 });

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const submit = () => {
    if (!name.trim()) return;
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
        ref={squircleRef}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{
          position: 'relative',
          width: '100%',
          background: '#ffffff',
          clipPath: clipPath || undefined,
          borderRadius: clipPath ? 0 : '36px 36px 0 0',
          padding: '18px 20px',
          paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'rgba(34,34,36,0.12)', borderRadius: 2, margin: '0 auto 20px' }} />

        {/* Title */}
        <h3 style={{ fontFamily: M, fontSize: 20, fontWeight: 500, color: '#0B0D10', textAlign: 'center', marginBottom: 20 }}>
          Новое событие
        </h3>

        {/* Name field */}
        <FieldBox style={{ marginBottom: 10 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Что на повестке дня?"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: M,
              fontSize: 15,
              fontWeight: name ? 500 : 400,
              color: name ? '#0B0D10' : 'rgba(11,13,16,0.3)',
            }}
          />
        </FieldBox>

        {/* Time row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
            <span style={{ fontFamily: M, fontSize: 15, fontWeight: start ? 500 : 400, color: start ? '#0B0D10' : 'rgba(11,13,16,0.3)' }}>
              {start || 'Начало'}
            </span>
            <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </FieldBox>
          <FieldBox style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
            <span style={{ fontFamily: M, fontSize: 15, fontWeight: end ? 500 : 400, color: end ? '#0B0D10' : 'rgba(11,13,16,0.3)' }}>
              {end || 'Конец'}
            </span>
            <img src={taskTimeIcon} width={20} height={20} style={{ opacity: 0.45, flexShrink: 0 }} alt="" />
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </FieldBox>
        </div>

        {/* Add button */}
        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: '100%',
            height: 52,
            background: name.trim() ? '#0B0D10' : 'rgba(11,13,16,0.18)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 999,
            fontFamily: M,
            fontSize: 16,
            fontWeight: 700,
            cursor: name.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s',
          }}
        >
          Добавить
        </button>
      </motion.div>
    </div>
  );
}

function FieldBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'relative',
      background: '#f5f5f5',
      borderRadius: 18,
      padding: '12px 16px',
      ...style,
    }}>
      {children}
    </div>
  );
}
