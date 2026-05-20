import { useState, useEffect } from 'react';
import { Pencil, ArrowLeft, ChevronDown, Check } from 'lucide-react';
import { Settings } from '../types';
import { getCurrentUser, apiFetch } from '../lib/auth';
import { storage } from '../lib/storage';
import {
  isGoogleCalendarConnected,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  fetchCalendarList,
  getSelectedCalendarId,
  setSelectedCalendarId,
  type GoogleCalendarItem,
} from '../lib/google-calendar';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

interface SettingsProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onBack: () => void;
  onLogout: () => void;
  isDesktop?: boolean;
}

function PillButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: M,
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        padding: '7px 16px',
        borderRadius: 40,
        border: `1px solid ${danger ? 'rgba(220,60,60,0.3)' : 'rgba(0,0,0,0.15)'}`,
        background: 'transparent',
        color: danger ? '#c0392b' : 'var(--text-primary)',
        cursor: 'pointer',
        whiteSpace: 'nowrap' as const,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

function SectionDivider() {
  return <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '16px 0 0' }} />;
}

function IntegrationRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div>
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0' }}>
        <div>
          <div style={{ fontFamily: M, fontSize: 15, color: 'var(--text-primary)', marginBottom: 3 }}>{name}</div>
          <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)' }}>{desc}</div>
        </div>
        <PillButton label="Подключить" onClick={() => alert('Скоро')} />
      </div>
    </div>
  );
}

function TelegramRow() {
  const [step, setStep] = useState<'idle' | 'code' | 'done'>('idle');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'MindexBot';

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    apiFetch(`/api/telegram/link-status`)
      .then(r => r.json())
      .then(d => { if (d.linked) setStep('done'); })
      .catch(() => {});
  }, []);

  const handleConnect = async () => {
    const user = getCurrentUser();
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/telegram/link-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setCode(data.code);
      setStep('code');

      // Polling — проверяем каждые 3 секунды, подключился ли пользователь
      const interval = setInterval(async () => {
        const r = await apiFetch(`/api/telegram/link-status`);
        const d = await r.json();
        if (d.linked) {
          clearInterval(interval);
          setStep('done');
        }
      }, 3000);
      setTimeout(() => clearInterval(interval), 10 * 60 * 1000); // стоп через 10 мин
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ padding: '18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: M, fontSize: 15, color: 'var(--text-primary)' }}>Telegram</span>
                <span style={{ fontFamily: M, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'rgba(120,120,120,0.9)', background: 'rgba(120,120,120,0.12)', padding: '2px 7px', borderRadius: 20 }}>бета</span>
              </div>
            <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)' }}>
              {step === 'done' ? '✅ Подключён — уведомления активны' : 'Уведомления о задачах прямо в Telegram'}
            </div>
          </div>
          {step === 'idle' && <PillButton label={loading ? '...' : 'Подключить'} onClick={handleConnect} />}
          {step === 'done' && <span style={{ fontFamily: M, fontSize: 12, color: '#4caf50' }}>Подключён</span>}
        </div>
        {step === 'code' && (
          <div style={{ marginTop: 14, padding: '14px 16px', background: 'rgba(0,0,0,0.04)', borderRadius: 12 }}>
            <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              1. Открой бота в Telegram
            </div>
            <a
              href={`https://t.me/${botUsername}?start=${code}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: M, fontSize: 14, color: '#5B6CF8', textDecoration: 'none', fontWeight: 500 }}
            >
              @{botUsername} →
            </a>
            <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)', marginTop: 10, marginBottom: 6 }}>
              2. Или введи код вручную командой:
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: 16, fontWeight: 700,
              letterSpacing: '0.12em', color: 'var(--text-primary)',
              background: 'rgba(0,0,0,0.06)', borderRadius: 8,
              padding: '8px 12px', display: 'inline-block'
            }}>
              /start {code}
            </div>
            <div style={{ fontFamily: M, fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Ожидаю подключения...
            </div>
            <div style={{ fontFamily: M, fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Код вводится один раз. После этого бот готов к работе.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleCalendarRow() {
  const [connected, setConnected] = useState(() => isGoogleCalendarConnected());
  const [loading, setLoading] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarItem[]>([]);
  const [selectedId, setSelectedId] = useState(() => getSelectedCalendarId());
  const [showPicker, setShowPicker] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const loadCalendars = async () => {
    setLoadingCalendars(true);
    try {
      const list = await fetchCalendarList();
      setCalendars(list);
    } finally {
      setLoadingCalendars(false);
    }
  };

  // Load calendar list on mount if already connected
  useEffect(() => {
    if (connected) {
      loadCalendars();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const ok = await connectGoogleCalendar();
      if (ok) {
        setConnected(true);
        await loadCalendars();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleCalendar();
    setConnected(false);
    setCalendars([]);
    setSelectedId('primary');
    setShowPicker(false);
  };

  const handleSelectCalendar = (id: string) => {
    setSelectedCalendarId(id);
    setSelectedId(id);
    setShowPicker(false);
  };

  const selectedCalendar = calendars.find(c => c.id === selectedId);
  const displayName = loadingCalendars
    ? 'Загружаем...'
    : selectedCalendar?.summary || (selectedId === 'primary' ? 'Основной' : selectedId);

  return (
    <div>
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ padding: '18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: M, fontSize: 15, color: 'var(--text-primary)', marginBottom: 3 }}>
              Google Календарь
            </div>
            <div style={{ fontFamily: M, fontSize: 13, color: connected ? '#22c55e' : 'var(--text-muted)' }}>
              {connected ? 'Подключён' : 'Синхронизация твоих событий и задач'}
            </div>
          </div>
          {connected ? (
            <PillButton label="Отключить" onClick={handleDisconnect} danger />
          ) : (
            <PillButton label={loading ? '...' : 'Подключить'} onClick={handleConnect} />
          )}
        </div>

        {connected && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: M, fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              Активный календарь
            </div>
            <button
              onClick={() => setShowPicker(v => !v)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.1)',
                background: 'var(--surface2, rgba(0,0,0,0.03))',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', fontFamily: M, fontSize: 14, color: 'var(--text-primary)',
                boxSizing: 'border-box' as const,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedCalendar?.backgroundColor && (
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: selectedCalendar.backgroundColor, flexShrink: 0 }} />
                )}
                <span>{displayName}</span>
              </div>
              <ChevronDown
                size={15}
                style={{ transform: showPicker ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
              />
            </button>

            {showPicker && calendars.length > 0 && (
              <div style={{
                marginTop: 4, borderRadius: 12, overflow: 'hidden',
                border: '1px solid rgba(0,0,0,0.08)',
                background: 'var(--surface)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              }}>
                {calendars.map((cal, idx) => (
                  <button
                    key={cal.id}
                    onClick={() => handleSelectCalendar(cal.id)}
                    style={{
                      width: '100%', padding: '11px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: cal.id === selectedId ? 'rgba(99,102,241,0.06)' : 'transparent',
                      border: 'none',
                      borderBottom: idx < calendars.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                      cursor: 'pointer', textAlign: 'left' as const,
                    }}
                  >
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: cal.backgroundColor || '#4285f4', flexShrink: 0,
                    }} />
                    <span style={{ fontFamily: M, fontSize: 14, color: 'var(--text-primary)', flex: 1 }}>
                      {cal.summary}
                    </span>
                    {cal.primary && (
                      <span style={{
                        fontFamily: M, fontSize: 11, color: 'var(--text-muted)',
                        background: 'rgba(0,0,0,0.06)', padding: '2px 8px', borderRadius: 20,
                      }}>
                        Основной
                      </span>
                    )}
                    {cal.id === selectedId && (
                      <Check size={14} color="var(--accent, #6366f1)" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingRow({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
        <div>
          <div style={{ fontFamily: M, fontSize: 15, color: 'var(--text-primary)', marginBottom: desc ? 2 : 0 }}>{label}</div>
          {desc && <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)' }}>{desc}</div>}
        </div>
        <button
          onClick={() => onChange(!value)}
          style={{
            width: 44, height: 24, borderRadius: 40, border: 'none',
            background: value ? 'var(--accent)' : 'rgba(0,0,0,0.12)',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3, left: value ? 23 : 3,
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>
    </div>
  );
}

function AccountRow({ label, action, onAction, danger }: { label: string; action: string; onAction: () => void; danger?: boolean }) {
  return (
    <div>
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0' }}>
        <span style={{ fontFamily: M, fontSize: 15, color: 'var(--text-primary)' }}>{label}</span>
        <PillButton label={action} onClick={onAction} danger={danger} />
      </div>
    </div>
  );
}

export default function SettingsScreen({ settings, setSettings, onBack, onLogout, isDesktop = false }: SettingsProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const currentUser = getCurrentUser();

  const displayName = settings.name || currentUser?.displayName || 'Пользователь';
  const email = settings.email || currentUser?.email || currentUser?.username || '';

  const getInitials = (name: string) =>
    name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const editName = () => {
    const next = prompt('Как тебя зовут?', displayName);
    if (next !== null) setSettings({ ...settings, name: next });
  };

  const clearMemory = () => {
    const user = getCurrentUser();
    if (user) storage.clearUserData(user.id);
    window.location.reload();
  };

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      background: 'var(--bg)',
      padding: isDesktop ? '40px 40px 60px' : 'env(safe-area-inset-top, 0px) 0 60px',
      boxSizing: 'border-box',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: isDesktop ? '0' : '0 20px' }}>
        {/* Header */}
        {isDesktop ? (
          <>
            <div style={{ fontFamily: F, fontSize: 36, color: 'var(--text-80)', textAlign: 'center', marginBottom: 24 }}>
              настройки
            </div>
            <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', marginBottom: 32 }} />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', paddingTop: 16, paddingBottom: 8, marginBottom: 8 }}>
              <button
                onClick={onBack}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px 8px 8px 0', display: 'flex', alignItems: 'center',
                  color: 'var(--text-primary)', flexShrink: 0,
                }}
              >
                <ArrowLeft size={22} strokeWidth={1.75} />
              </button>
              <div style={{ flex: 1, fontFamily: F, fontSize: 22, color: 'var(--text-80)', textAlign: 'center' }}>
                настройки
              </div>
              <div style={{ width: 30 }} />
            </div>
            <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', marginBottom: 24 }} />
          </>
        )}

        {/* Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          {/* Avatar */}
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: settings.avatar ? 'var(--text-primary)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {settings.avatar ? (
              <img src={settings.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <svg width="48" height="48" viewBox="0 0 125 125" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="62.5" cy="62.5" r="62.5" fill="#222224"/>
                <rect x="29.45" y="30.45" width="65.1" height="65.1" rx="32.55" stroke="#FEFEFE" strokeWidth="4.9"/>
                <path d="M77 68L77 51" stroke="#FEFEFE" strokeWidth="4.9"/>
                <path d="M65 68L65 51" stroke="#FEFEFE" strokeWidth="4.9"/>
              </svg>
            )}
          </div>

          {/* Name + email */}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: M, fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
              {displayName}
            </div>
            {email && (
              <div style={{ fontFamily: M, fontSize: 13, color: 'var(--text-muted)' }}>
                {email}
              </div>
            )}
          </div>

          {/* Edit */}
          <button
            onClick={editName}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--text-40)' }}
          >
            <Pencil size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Instructions */}
        <SectionDivider />
        <div style={{ paddingTop: 16, marginBottom: 20 }}>
          <div style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>
            Инструкции
          </div>
          <textarea
            value={settings.instructions || ''}
            onChange={e => setSettings({ ...settings, instructions: e.target.value })}
            placeholder="Опиши, как ты хочешь, чтобы ии с тобой общался"
            style={{
              width: '100%',
              minHeight: 100,
              borderRadius: 16,
              border: '1px solid rgba(0,0,0,0.08)',
              padding: '14px 16px',
              fontFamily: M,
              fontSize: 14,
              color: 'var(--text-primary)',
              background: 'var(--surface)',
              resize: 'vertical' as const,
              outline: 'none',
              lineHeight: 1.6,
              boxSizing: 'border-box' as const,
            }}
          />
        </div>

        {/* Integrations */}
        <SectionDivider />
        <div style={{ paddingTop: 16, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
              Интеграции
            </div>
          </div>
          <TelegramRow />
          <GoogleCalendarRow />
        </div>

        {/* Account */}
        <SectionDivider />
        <div style={{ paddingTop: 16 }}>
          <div style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
            Данные и аккаунт
          </div>
          <AccountRow label="Выйти из аккаунта" action="Выйти" onAction={onLogout} />
          <AccountRow
            label="Память модели"
            action="Очистить"
            onAction={() => setConfirmClear(true)}
            danger
          />
        </div>
      </div>

      {/* Confirm clear modal */}
      {confirmClear && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: 24,
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 20,
            padding: 32,
            maxWidth: 340,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }}>
            <div style={{ fontFamily: M, fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'center' }}>
              Очистить память?
            </div>
            <div style={{ fontFamily: M, fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              Это удалит все локальные задачи, переписки и настройки без возможности восстановления.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={clearMemory}
                style={{
                  height: 44, borderRadius: 40, background: '#c0392b',
                  border: 'none', color: '#fff', cursor: 'pointer',
                  fontFamily: M, fontSize: 14, fontWeight: 500,
                }}
              >
                Удалить всё
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                style={{
                  height: 44, borderRadius: 40, background: 'transparent',
                  border: '1px solid var(--border-input)', color: 'var(--text-primary)',
                  cursor: 'pointer', fontFamily: M, fontSize: 14,
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
