import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/auth';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'mysle_tgbot';

export default function TelegramConnectBlock() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch('/api/telegram/link-code', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.code) setCode(d.code); })
      .catch(() => {});
  }, []);

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(`/start ${code}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(34,34,36,0.08)', margin: '0 -2px' }} />

      {/* Description */}
      <div style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.55)', lineHeight: 1.55 }}>
        Кстати, со мной можно общаться через тг, чтобы быстро ставить задачи, строить планы и получать напоминания быстрее всех
      </div>

      {/* Button */}
      <a
        href={`https://t.me/${BOT_USERNAME}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', width: '100%', padding: '11px 0',
          background: '#0B0D10', color: '#fff', borderRadius: 12,
          fontFamily: M, fontSize: 14, fontWeight: 500,
          textAlign: 'center', textDecoration: 'none',
          boxSizing: 'border-box',
        }}
      >
        Подключить Telegram
      </a>

      {/* Code chip */}
      {code && (
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '9px 12px',
            background: 'rgba(34,34,36,0.06)', border: 'none',
            borderRadius: 10, cursor: 'pointer', boxSizing: 'border-box',
          }}
        >
          <span style={{ fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.5)' }}>
            Отправь этот код боту
          </span>
          <span style={{
            fontFamily: M, fontSize: 13, fontWeight: 600,
            color: copied ? 'rgba(34,34,36,0.4)' : '#0B0D10',
            transition: 'color 0.2s',
            letterSpacing: '0.04em',
          }}>
            {copied ? 'Скопировано' : `/start ${code}`}
          </span>
        </button>
      )}
    </div>
  );
}
