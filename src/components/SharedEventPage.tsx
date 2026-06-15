import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Loader2, Calendar, MapPin, Check, ArrowRight } from 'lucide-react';
import { SharedEvent, LocalUser } from '../types';
import { getSessionToken, apiFetch } from '../lib/auth';
import { useGoogleLogin } from '../lib/useGoogleLogin';

// Дизайн-токены публичной страницы — те же, что у экрана входа (off-white, тёмный акцент).
const F = "'Random Grotesque', sans-serif";
const M = "'Muller', sans-serif";
const BG = '#f0f0f0';
const FG = '#222224';

const PENDING_KEY = 'pending_event_add';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «20 июня, 18:00–20:00» — собираем человекочитаемо, скрывая пустое время. */
function formatWhen(date: string, time?: string, endTime?: string): string {
  let dateLabel = date;
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    dateLabel = `${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
  }
  if (time && endTime) return `${dateLabel}, ${time}–${endTime}`;
  if (time) return `${dateLabel}, ${time}`;
  return dateLabel;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'show'; event: SharedEvent };

type AddState = 'idle' | 'adding' | 'added' | 'already' | 'error';

interface Props {
  eventId: string;
  /** Уход в основное приложение (на главный экран SPA). */
  onOpenApp: () => void;
}

export default function SharedEventPage({ eventId, onOpenApp }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [addState, setAddState] = useState<AddState>('idle');
  const [addError, setAddError] = useState('');
  const autoTriedRef = useRef(false);

  // Добавление события через авторизованный запрос. Возвращает результат для возобновления.
  const addToCalendar = useCallback(async () => {
    setAddState('adding');
    setAddError('');
    try {
      const res = await apiFetch(`/api/events/${eventId}/add`, { method: 'POST' });
      if (res.status === 410) {
        setAddState('error');
        setAddError('Это событие уже прошло.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.added) {
        setAddState('error');
        setAddError(data.error || 'Не получилось добавить. Попробуй ещё раз.');
        return;
      }
      localStorage.removeItem(PENDING_KEY);
      setAddState(data.already ? 'already' : 'added');
    } catch {
      setAddState('error');
      setAddError('Нет связи. Проверь интернет и попробуй снова.');
    }
  }, [eventId]);

  // Колбэк успешного логина (холодный гейт): сразу добавляем событие.
  const handleLoginSuccess = useCallback((_user: LocalUser) => {
    void addToCalendar();
  }, [addToCalendar]);

  const google = useGoogleLogin(handleLoginSuccess);

  // Загрузка события (публичный запрос, без токена).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}`)
      .then(async (r) => {
        if (r.status === 404) { if (!cancelled) setStatus({ kind: 'notfound' }); return; }
        const data = await r.json().catch(() => null);
        if (!data || !data.id) { if (!cancelled) setStatus({ kind: 'notfound' }); return; }
        if (!cancelled) setStatus({ kind: 'show', event: data as SharedEvent });
      })
      .catch(() => { if (!cancelled) setStatus({ kind: 'notfound' }); });
    return () => { cancelled = true; };
  }, [eventId]);

  // Возобновление после OAuth-редиректа/перезагрузки: есть сессия + pending совпадает → добавляем.
  useEffect(() => {
    if (autoTriedRef.current) return;
    if (status.kind !== 'show' || status.event.expired) return;
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending === eventId && getSessionToken()) {
      autoTriedRef.current = true;
      void addToCalendar();
    }
  }, [status, eventId, addToCalendar]);

  const handleAddClick = () => {
    if (getSessionToken()) {
      void addToCalendar();
    } else {
      // Холодный гейт: запомним событие, чтобы не потерять его после логина.
      localStorage.setItem(PENDING_KEY, eventId);
      void google.startLogin();
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center px-6 py-10"
      style={{ backgroundColor: BG, justifyContent: 'center' }}
    >
      {/* Скрытый контейнер для Google-iframe — вне display:none блоков */}
      <div
        ref={google.buttonRef}
        style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden', top: 0, left: 0 }}
      />

      {status.kind === 'loading' && (
        <Loader2 size={28} className="animate-spin" style={{ color: FG }} />
      )}

      {status.kind === 'notfound' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="w-full max-w-[440px] text-center"
        >
          <div style={{ fontFamily: M, fontSize: 22, fontWeight: 500, color: FG, marginBottom: 12 }}>
            Такого события нет
          </div>
          <div style={{ fontFamily: F, fontSize: 15, color: 'rgba(11,13,16,0.55)', marginBottom: 28, lineHeight: 1.5 }}>
            Возможно, ссылка устарела или организатор её удалил.
          </div>
          <CalendarLink onClick={onOpenApp} label="Открыть Mindex" />
        </motion.div>
      )}

      {status.kind === 'show' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-[440px] flex flex-col items-center"
        >
          {/* Карточка события */}
          <div
            className="w-full rounded-[28px] p-6"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}
          >
            {status.event.partnerName && (
              <div style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.45)', marginBottom: 10 }}>
                {status.event.partnerName} приглашает
              </div>
            )}
            <div style={{ fontFamily: M, fontSize: 24, fontWeight: 600, color: FG, lineHeight: 1.25, wordBreak: 'break-word' }}>
              {status.event.title}
            </div>

            <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
              <Calendar size={16} style={{ color: FG, flexShrink: 0 }} />
              <span style={{ fontFamily: M, fontSize: 15, color: FG }}>
                {formatWhen(status.event.date, status.event.time, status.event.endTime)}
              </span>
            </div>

            {status.event.location && (
              <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                <MapPin size={16} style={{ color: FG, flexShrink: 0 }} />
                <span style={{ fontFamily: M, fontSize: 15, color: FG, wordBreak: 'break-word' }}>
                  {status.event.location}
                </span>
              </div>
            )}

            {status.event.description && (
              <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.6)', marginTop: 16, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {status.event.description}
              </div>
            )}
          </div>

          {/* Состояние действия */}
          <div className="w-full" style={{ marginTop: 20 }}>
            {status.event.expired ? (
              <div className="w-full text-center">
                <div style={{ fontFamily: M, fontSize: 16, color: FG, marginBottom: 8 }}>
                  Это событие уже прошло
                </div>
                <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.5)', marginBottom: 20 }}>
                  Но я могу помочь тебе с тем, что впереди.
                </div>
                <CalendarLink onClick={onOpenApp} label="Открыть Mindex" />
              </div>
            ) : addState === 'added' ? (
              <SuccessBlock
                title="Готово, добавил в твой календарь"
                subtitle="Напомню заранее — не пропустишь."
                onOpenApp={onOpenApp}
              />
            ) : addState === 'already' ? (
              <SuccessBlock
                title="Это событие уже у тебя в календаре"
                subtitle="Я слежу за ним — напомню вовремя."
                onOpenApp={onOpenApp}
              />
            ) : getSessionToken() ? (
              <>
                <PrimaryButton
                  onClick={handleAddClick}
                  loading={addState === 'adding'}
                  label="Добавить в календарь"
                />
                {addState === 'error' && <ErrorNote text={addError} />}
              </>
            ) : (
              // Холодный гейт: незарегистрированный участник
              <div className="w-full flex flex-col items-center">
                <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.6)', textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>
                  Войди, чтобы добавить — и я напомню заранее.
                </div>
                <PrimaryButton
                  onClick={handleAddClick}
                  loading={google.loading || addState === 'adding'}
                  label="Войти через Google"
                  icon={<GoogleIcon />}
                  disabled={!google.ready}
                />
                {(google.error || addState === 'error') && <ErrorNote text={google.error || addError} />}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function PrimaryButton({ onClick, loading, label, icon, disabled }: {
  onClick: () => void; loading?: boolean; label: string; icon?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      whileTap={!loading && !disabled ? { scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="w-full h-[52px] rounded-full flex items-center justify-center gap-2.5 disabled:opacity-60"
      style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8', border: 'none', cursor: loading || disabled ? 'default' : 'pointer' }}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : <>{icon}{label}</>}
    </motion.button>
  );
}

function SuccessBlock({ title, subtitle, onOpenApp }: { title: string; subtitle: string; onOpenApp: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: 'easeOut' }}
      className="w-full flex flex-col items-center text-center"
    >
      <div
        className="flex items-center justify-center rounded-full"
        style={{ width: 48, height: 48, background: FG, marginBottom: 14 }}
      >
        <Check size={24} color="#f8f8f8" />
      </div>
      <div style={{ fontFamily: M, fontSize: 17, fontWeight: 500, color: FG, marginBottom: 6 }}>{title}</div>
      <div style={{ fontFamily: F, fontSize: 14, color: 'rgba(11,13,16,0.55)', marginBottom: 22 }}>{subtitle}</div>
      <CalendarLink onClick={onOpenApp} label="Открыть календарь" />
    </motion.div>
  );
}

function CalendarLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="inline-flex items-center justify-center gap-1.5 h-[48px] px-6 rounded-full"
      style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}
    >
      {label}
      <ArrowRight size={16} />
    </motion.button>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-2 text-sm w-full text-center"
      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F, marginTop: 12 }}
    >
      {text}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 72 73" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M71.2941 37.1865C71.2941 34.1958 71.0515 32.0133 70.5262 29.75H36.3745V43.2489H56.4208C56.0168 46.6035 53.8343 51.6556 48.9843 55.0503L48.9163 55.5023L59.7144 63.8675L60.4626 63.9421C67.3332 57.5967 71.2941 48.2605 71.2941 37.1865Z" fill="#ffffff"/>
      <path d="M36.3746 72.7508C46.1956 72.7508 54.4405 69.5174 60.4627 63.9401L48.9844 55.0483C45.9128 57.1904 41.7903 58.6858 36.3746 58.6858C26.7556 58.6858 18.5916 52.3406 15.6814 43.5703L15.2548 43.6065L4.02672 52.296L3.87988 52.7042C9.86143 64.5865 22.148 72.7508 36.3746 72.7508Z" fill="#ffffff"/>
      <path d="M15.6813 43.5666C14.9135 41.3033 14.469 38.8781 14.469 36.3724C14.469 33.8665 14.9135 31.4416 15.6409 29.1783L15.6206 28.6963L4.25183 19.8672L3.87987 20.0441C1.41458 24.975 0 30.5121 0 36.3724C0 42.2328 1.41458 47.7696 3.87987 52.7005L15.6813 43.5666Z" fill="#ffffff"/>
      <path d="M36.3746 14.0648C43.2049 14.0648 47.8122 17.0151 50.4394 19.4807L60.7051 9.4574C54.4003 3.59706 46.1956 0 36.3746 0C22.148 0 9.86142 8.16402 3.87988 20.0463L15.641 29.1805C18.5916 20.4102 26.7556 14.0648 36.3746 14.0648Z" fill="#ffffff"/>
    </svg>
  );
}
