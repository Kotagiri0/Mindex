import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Mail } from 'lucide-react';
import { storage } from '../lib/storage';

interface EmailAttachBannerProps {
  onDismiss: () => void;
}

const F = "'Random Grotesque', sans-serif";
const M = "'Muller', sans-serif";


async function sendOtp(email: string): Promise<void> {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
}

async function attachEmail(email: string, otp: string): Promise<void> {
  const token = storage.getSessionToken();
  const res = await fetch('/api/auth/attach-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Неверный код');
  // Обновляем currentUser в storage — чтобы баннер не появился снова
  // и при следующем входе по OTP пользователь находился по email
  if (data.user) {
    storage.setCurrentUser(data.user);
  }
}

export default function EmailAttachBanner({ onDismiss }: EmailAttachBannerProps) {
  const [step, setStep] = useState<'prompt' | 'email' | 'otp' | 'done'>('prompt');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpRef.current?.focus(), 100);
  }, [step]);

  const handleDismiss = () => {
    onDismiss();
  };

  const handleSendOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Введи корректный email');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await sendOtp(trimmed);
      setStep('otp');
      setResendCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleAttach = async (code = otp) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const trimmedOtp = code.trim();
    if (trimmedOtp.length !== 6) { setError('Код — 6 цифр'); submittingRef.current = false; return; }
    setError('');
    setLoading(true);
    try {
      await attachEmail(email.trim().toLowerCase(), trimmedOtp);
      setStep('done');
      setTimeout(() => onDismiss(), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неверный код');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setError('');
    setLoading(true);
    try {
      await sendOtp(email.trim().toLowerCase());
      setResendCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-safe"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
    >
      <motion.div
        initial={{ y: 120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 120, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 340 }}
        className="w-full max-w-[480px] rounded-[28px] px-5 pt-5 pb-5 flex flex-col gap-3"
        style={{ background: '#ffffff', boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}
      >
        {/* Шаг: prompt */}
        {step === 'prompt' && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: '#f0f0f0' }}
                >
                  <Mail size={18} color="#222224" />
                </div>
                <div>
                  <div style={{ fontFamily: M, fontSize: '0.95rem', fontWeight: 600, color: '#222224' }}>
                    Новая система входа
                  </div>
                  <div style={{ fontFamily: F, fontSize: '0.82rem', color: 'rgba(11,13,16,0.5)', marginTop: 2 }}>
                    Добавь email, чтобы не потерять доступ к аккаунту
                  </div>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                style={{ color: 'rgba(11,13,16,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </div>
            <button
              onClick={() => setStep('email')}
              className="w-full h-12 rounded-full flex items-center justify-center"
              style={{ background: '#222224', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8' }}
            >
              Привязать email
            </button>
          </>
        )}

        {/* Шаг: ввод email */}
        {step === 'email' && (
          <>
            <div className="flex items-center justify-between">
              <div style={{ fontFamily: M, fontSize: '0.95rem', fontWeight: 600, color: '#222224' }}>
                Введи email
              </div>
              <button
                onClick={handleDismiss}
                style={{ color: 'rgba(11,13,16,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="w-full h-13 rounded-[20px] flex items-center px-4"
              style={{ height: 52, background: '#f5f5f5', border: '1.5px solid rgba(0,0,0,0.08)' }}
            >
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                placeholder="Твой email"
                autoComplete="email"
                className="w-full bg-transparent outline-none"
                style={{ fontFamily: F, fontSize: '1rem', color: 'rgba(11,13,16,0.8)' }}
                autoFocus
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-2xl px-4 py-2 text-sm"
                  style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', fontFamily: F }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-2">
              <button
                onClick={() => { setStep('prompt'); setError(''); }}
                className="flex-1 h-12 rounded-full flex items-center justify-center"
                style={{ background: '#f0f0f0', fontFamily: M, fontSize: '0.9rem', color: '#222224' }}
              >
                Назад
              </button>
              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="flex-[2] h-12 rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: '#222224', fontFamily: M, fontSize: '0.9rem', fontWeight: 500, color: '#f8f8f8' }}
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Получить код
              </button>
            </div>
          </>
        )}

        {/* Шаг: ввод кода */}
        {step === 'otp' && (
          <>
            <div className="flex items-center justify-between">
              <div style={{ fontFamily: M, fontSize: '0.95rem', fontWeight: 600, color: '#222224' }}>
                Введи код из письма
              </div>
              <button
                onClick={handleDismiss}
                style={{ color: 'rgba(11,13,16,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{ fontFamily: F, fontSize: '0.83rem', color: 'rgba(11,13,16,0.5)', textAlign: 'center' }}
            >
              Отправили на <span style={{ color: '#222224', fontWeight: 500 }}>{email}</span>
            </div>

            <div
              className="w-full rounded-[20px] flex items-center px-4"
              style={{ height: 52, background: '#f5f5f5', border: '1.5px solid rgba(0,0,0,0.08)' }}
            >
              <input
                ref={otpRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtp(v);
                  if (v.length === 6) setTimeout(() => handleAttach(v), 0);
                }}
                placeholder="6-значный код"
                autoComplete="one-time-code"
                className="w-full bg-transparent outline-none text-center tracking-[0.3em]"
                style={{ fontFamily: F, fontSize: '1.3rem', color: 'rgba(11,13,16,0.8)' }}
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-2xl px-4 py-2 text-sm"
                  style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', fontFamily: F }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={() => handleAttach()}
              disabled={loading || otp.length !== 6}
              className="w-full h-12 rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: '#222224', fontFamily: M, fontSize: '0.9rem', fontWeight: 500, color: '#f8f8f8' }}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Привязать
            </button>

            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => { setStep('email'); setOtp(''); setError(''); }}
                style={{ fontFamily: F, fontSize: '0.85rem', color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Изменить email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                style={{ fontFamily: F, fontSize: '0.85rem', color: resendCooldown > 0 ? 'rgba(11,13,16,0.3)' : 'rgba(11,13,16,0.6)', background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer' }}
              >
                {resendCooldown > 0 ? `Повторить через ${resendCooldown}с` : 'Отправить снова'}
              </button>
            </div>
          </>
        )}

        {/* Шаг: готово */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div style={{ fontSize: '2rem' }}>✅</div>
            <div style={{ fontFamily: M, fontSize: '1rem', fontWeight: 600, color: '#222224' }}>
              Email привязан
            </div>
            <div style={{ fontFamily: F, fontSize: '0.85rem', color: 'rgba(11,13,16,0.5)' }}>
              Теперь можешь войти по коду из письма
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** Нужно ли показывать баннер для данного пользователя */
export function shouldShowEmailBanner(provider?: string, email?: string): boolean {
  if (provider === 'google' || provider === 'email') return false;
  if (email) return false;
  return true;
}
