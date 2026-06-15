import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2, Check, Copy } from 'lucide-react';
import { getSessionToken, apiFetch } from '../lib/auth';

const F = "'Random Grotesque', sans-serif";
const M = "'Muller', sans-serif";
const BG = '#f0f0f0';
const FG = '#222224';

interface Props {
  /** Уход в основное приложение / на вход. */
  onOpenApp: () => void;
}

interface CreatedEvent {
  id: string;
  url: string;
  buttonSnippet: string;
}

export default function CreateEventPage({ onOpenApp }: Props) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedEvent | null>(null);
  const [copied, setCopied] = useState<'url' | 'snippet' | null>(null);

  const hasSession = Boolean(getSessionToken());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!title.trim() || !date) {
      setError('Заполни хотя бы название и дату.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          date,
          time: time || undefined,
          endTime: endTime || undefined,
          location: location.trim() || undefined,
          description: description.trim() || undefined,
          partnerName: partnerName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        setError(data.error || 'Не получилось создать событие. Попробуй ещё раз.');
        return;
      }
      setCreated({ id: data.id, url: data.url, buttonSnippet: data.buttonSnippet });
    } catch {
      setError('Нет связи. Проверь интернет и попробуй снова.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, which: 'url' | 'snippet') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* буфер недоступен — пользователь скопирует вручную */
    }
  };

  if (!hasSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: BG }}>
        <div className="w-full max-w-[440px] text-center">
          <div style={{ fontFamily: M, fontSize: 22, fontWeight: 500, color: FG, marginBottom: 12 }}>
            Сначала войди
          </div>
          <div style={{ fontFamily: F, fontSize: 15, color: 'rgba(11,13,16,0.55)', marginBottom: 24, lineHeight: 1.5 }}>
            Создавать события могут только участники Mindex. Войди — и сделаем ссылку для твоего поста.
          </div>
          <motion.button
            type="button" onClick={onOpenApp} whileTap={{ scale: 0.97 }}
            className="h-[52px] px-7 rounded-full"
            style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8', border: 'none', cursor: 'pointer' }}
          >
            Войти
          </motion.button>
        </div>
      </div>
    );
  }

  if (created) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10" style={{ backgroundColor: BG }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-[480px] flex flex-col items-center"
        >
          <div className="flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: FG, marginBottom: 14 }}>
            <Check size={24} color="#f8f8f8" />
          </div>
          <div style={{ fontFamily: M, fontSize: 20, fontWeight: 600, color: FG, marginBottom: 6, textAlign: 'center' }}>
            Ссылка готова
          </div>
          <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.55)', marginBottom: 24, textAlign: 'center', lineHeight: 1.5 }}>
            Вставь её в свой пост — участники добавят событие в один тап.
          </div>

          <CopyField label="Ссылка на событие" value={created.url} copied={copied === 'url'} onCopy={() => copy(created.url, 'url')} />
          <CopyField label="Готовый блок для поста" value={created.buttonSnippet} copied={copied === 'snippet'} onCopy={() => copy(created.buttonSnippet, 'snippet')} multiline />

          <motion.button
            type="button" onClick={onOpenApp} whileTap={{ scale: 0.97 }}
            className="h-[48px] px-6 rounded-full mt-2"
            style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
          >
            Открыть Mindex
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-10" style={{ backgroundColor: BG }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-[480px]"
      >
        <div style={{ fontFamily: M, fontSize: 22, fontWeight: 600, color: FG, marginBottom: 6 }}>
          Новое событие
        </div>
        <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.55)', marginBottom: 24, lineHeight: 1.5 }}>
          Заполни — и получишь ссылку для поста. Звёздочка обязательна.
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Название *">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Встреча сообщества" maxLength={120} style={inputStyle} />
          </Field>

          <div className="flex gap-3">
            <Field label="Дата *" className="flex-1">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <div className="flex gap-3">
            <Field label="Начало" className="flex-1">
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Конец" className="flex-1">
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Место">
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Адрес или ссылка на встречу" maxLength={200} style={inputStyle} />
          </Field>

          <Field label="Описание">
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="О чём событие?" rows={3} maxLength={1000} style={{ ...inputStyle, height: 'auto', borderRadius: 18, paddingTop: 14, paddingBottom: 14, resize: 'vertical' }} />
          </Field>

          <Field label="Организатор">
            <input value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Имя или название сообщества" maxLength={80} style={inputStyle} />
          </Field>

          {error && (
            <div className="rounded-2xl px-4 py-2 text-sm" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}>
              {error}
            </div>
          )}

          <motion.button
            type="submit" disabled={loading} whileTap={!loading ? { scale: 0.98 } : undefined}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
            style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8', border: 'none', cursor: loading ? 'default' : 'pointer' }}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Создать ссылку
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 52,
  borderRadius: 26,
  padding: '0 20px',
  background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.1)',
  fontFamily: M,
  fontSize: '0.95rem',
  color: FG,
  outline: 'none',
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.5)', paddingLeft: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function CopyField({ label, value, copied, onCopy, multiline }: {
  label: string; value: string; copied: boolean; onCopy: () => void; multiline?: boolean;
}) {
  return (
    <div className="w-full" style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.5)', marginBottom: 6, paddingLeft: 4 }}>{label}</div>
      <div
        className="w-full flex items-center gap-2 rounded-[20px] p-2"
        style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.1)' }}
      >
        <div
          style={{ flex: 1, fontFamily: M, fontSize: 13, color: FG, padding: '6px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: multiline ? 'pre-wrap' : 'nowrap', wordBreak: 'break-all', maxHeight: multiline ? 120 : undefined, overflowY: multiline ? 'auto' : undefined }}
        >
          {value}
        </div>
        <motion.button
          type="button" onClick={onCopy} whileTap={{ scale: 0.94 }}
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{ width: 40, height: 40, background: copied ? FG : '#f0f0f0', border: 'none', cursor: 'pointer', color: copied ? '#f8f8f8' : FG }}
          aria-label="Скопировать"
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </motion.button>
      </div>
    </div>
  );
}
