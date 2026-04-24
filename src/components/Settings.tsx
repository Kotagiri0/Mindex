import { useState } from 'react';
import { Pencil, Pause } from 'lucide-react';
import { Settings } from '../types';
import { getCurrentUser } from '../lib/auth';
import { storage } from '../lib/storage';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

interface SettingsProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onBack: () => void;
  onLogout: () => void;
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
  return <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '24px 0 0' }} />;
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

export default function SettingsScreen({ settings, setSettings, onBack, onLogout }: SettingsProps) {
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
      flex: 1,
      overflowY: 'auto',
      background: 'var(--bg)',
      padding: '40px 40px 60px',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Title */}
        <div style={{ fontFamily: F, fontSize: 36, color: 'var(--text-80)', textAlign: 'center', marginBottom: 24 }}>
          настройки
        </div>
        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', marginBottom: 32 }} />

        {/* Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          {/* Avatar */}
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {settings.avatar ? (
              <img src={settings.avatar} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <Pause size={18} color="#fff" strokeWidth={2} fill="#fff" />
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
        <div style={{ paddingTop: 24, marginBottom: 32 }}>
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
        <div style={{ paddingTop: 24, marginBottom: 8 }}>
          <div style={{ fontFamily: M, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
            Интеграции
          </div>
          <IntegrationRow name="Google Календарь" desc="Синхронизация твоих событий и задач" />
          <IntegrationRow name="Яндекс Календарь" desc="Синхронизация твоих событий и задач" />
          <IntegrationRow name="Notion" desc="Импорт страниц как заметок" />
        </div>

        {/* Account */}
        <SectionDivider />
        <div style={{ paddingTop: 24 }}>
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
