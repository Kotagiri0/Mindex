import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { LocalUser } from '../types';
import { loginLocalUser } from '../lib/auth';
import { storage } from '../lib/storage';
import { useHashRoute } from '../lib/useHashRoute';
import { useYandexLogin } from '../lib/useYandexLogin';
import PrimeMascot, { PrimeEyes, PrimeDecor } from './PrimeMascot';

interface LocalAuthProps {
  onAuthenticated: (user: LocalUser) => void;
}

function YandexMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#FC3F1D" />
      <path d="M13.2 6.6h-1.06c-1.94 0-2.96 1-2.96 2.48 0 1.66.72 2.44 2.18 3.43l1.2.82-3.46 5.17H6.6l3.1-4.62c-1.78-1.28-2.78-2.52-2.78-4.62 0-2.64 1.84-4.44 5.32-4.44h2.62V18.5H13.2V6.6Z" fill="#fff" />
    </svg>
  );
}

const F = "'Random Grotesque', sans-serif";
const M = "'Muller', sans-serif";
const BG = '#f0f0f0';
const FG = '#222224';

// Обязательное согласие на обработку ПДн (152-ФЗ). Без отметки вход недоступен.
function ConsentCheck({ agreed, setAgreed }: { agreed: boolean; setAgreed: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '0 6px', cursor: 'pointer', maxWidth: 400 }}>
      <input
        type="checkbox"
        checked={agreed}
        onChange={e => setAgreed(e.target.checked)}
        style={{ width: 16, height: 16, marginTop: 2, accentColor: FG, flexShrink: 0, cursor: 'pointer' }}
      />
      <span style={{ fontFamily: M, fontSize: 12, lineHeight: 1.45, color: 'rgba(11,13,16,0.5)' }}>
        Я согласен с{' '}
        <a href="/legal/terms.html" target="_blank" rel="noopener" style={{ color: 'rgba(11,13,16,0.7)', textDecoration: 'underline' }}>Соглашением</a>,{' '}
        <a href="/legal/privacy.html" target="_blank" rel="noopener" style={{ color: 'rgba(11,13,16,0.7)', textDecoration: 'underline' }}>Политикой</a>{' '}
        и даю{' '}
        <a href="/legal/consent.html" target="_blank" rel="noopener" style={{ color: 'rgba(11,13,16,0.7)', textDecoration: 'underline' }}>согласие на обработку данных</a>
      </span>
    </label>
  );
}

async function sendOtp(email: string, mode: AuthMode): Promise<void> {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
}

async function verifyOtp(email: string, otp: string, mode: AuthMode, consent: boolean): Promise<LocalUser> {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp, mode, consent }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Неверный код');
  storage.setSessionToken(data.token);
  storage.setCurrentUser(data.user);
  storage.setSessionUserId(data.user.id);
  return data.user;
}

type AuthMode = 'login' | 'signup';
type Step = 'choice' | 'email' | 'code' | 'legacy';

export default function LocalAuth({ onAuthenticated }: LocalAuthProps) {
  // Хеш-роутинг: '#/login' и '#/signup'. По умолчанию — '/login'.
  const [route, navigate] = useHashRoute('/login');
  const mode: AuthMode = route.startsWith('/signup') ? 'signup' : 'login';

  // Мобильная адаптация: больше отступ заголовок→форма и нижние ссылки прижаты к низу экрана
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [step, setStep] = useState<Step>('choice');
  const [agreed, setAgreed] = useState(false);
  // Согласие обязательно только при регистрации. На входе аккаунт уже существует и согласие дано ранее.
  const blockAuth = mode === 'signup' && !agreed;
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [legacyUsername, setLegacyUsername] = useState('');
  const [legacyPassword, setLegacyPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const yandex = useYandexLogin(onAuthenticated);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  // При смене хеш-маршрута возвращаемся на стартовый шаг и чистим состояние
  useEffect(() => {
    setStep('choice');
    setError('');
    setEmail('');
    setOtp('');
    setLegacyUsername('');
    setLegacyPassword('');
  }, [mode]);

  // Ошибки Яндекс-входа показываем в общем поле ошибок
  useEffect(() => {
    if (yandex.error) setError(yandex.error);
  }, [yandex.error]);

  const handleYandexClick = () => {
    if (blockAuth) { setError('Поставь галочку согласия, чтобы продолжить'); return; }
    setError('');
    yandex.startLogin(agreed);
  };

  // Автофокус на полях
  useEffect(() => {
    if (step === 'email') setTimeout(() => emailRef.current?.focus(), 100);
    if (step === 'code') setTimeout(() => otpRef.current?.focus(), 100);
  }, [step]);

  // Таймер повторной отправки
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendOtp = async (e?: FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Введи корректный email');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await sendOtp(trimmed, mode);
      setStep('code');
      setResendCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e?: FormEvent, code?: string) => {
    e?.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    const trimmedOtp = (code ?? otp).trim();
    if (trimmedOtp.length !== 6) { setError('Код — 6 цифр'); submittingRef.current = false; return; }
    setError('');
    setLoading(true);
    try {
      const user = await verifyOtp(email.trim().toLowerCase(), trimmedOtp, mode, agreed);
      onAuthenticated(user);
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
      await sendOtp(email.trim().toLowerCase(), mode);
      setResendCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setLoading(false); }
  };

  const handleLegacyLogin = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    const username = legacyUsername.trim();
    if (!username || !legacyPassword) {
      setError('Введи имя пользователя и пароль');
      submittingRef.current = false;
      return;
    }
    setError('');
    setLoading(true);
    try {
      const user = await loginLocalUser({ username, password: legacyPassword });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  // ── Что показывает маскот в зависимости от шага ──
  const isLogin = mode === 'login';
  const eyes: PrimeEyes =
    step === 'email' ? 'down'
    : step === 'code' ? 'away'
    : isLogin ? 'waking' : 'idle';
  const decor: PrimeDecor =
    step === 'email' ? 'question'
    : step === 'code' ? 'dots'
    : 'none';
  const wakeUp = step === 'choice' && isLogin;

  // ── Заголовок на choice-шаге ──
  const choiceTitle = isLogin ? 'снова в прайме?' : 'время создать аккаунт';

  // ── Текст под формой выбора (кросс-ссылка) ──
  const crossLinkText = isLogin ? 'Ещё нет? Начни здесь' : 'Уже с нами? Войди здесь';
  const crossLinkTarget = isLogin ? '/signup' : '/login';

  // Заголовки шагов email/code
  const emailTitle = 'введи email здесь';
  const codeTitle = 'код уже на почте';

  return (
    <div
      className="min-h-screen flex flex-col items-center px-6 local-auth-root"
      style={{ backgroundColor: BG, justifyContent: isMobile ? 'flex-start' : 'center', paddingTop: isMobile ? '20vh' : 0 }}
    >
      <style>{`
        .local-auth-root .input-row {
          transition: border-color 0.2s ease, background-color 0.2s ease;
        }
        .local-auth-root .input-row:focus-within {
          border-color: rgba(0,0,0,0.25);
          background-color: #ffffff;
        }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-[440px] flex flex-col items-center"
        style={{ gap: 0 }}
      >
        {/* Маскот (login) / Логотип (signup) */}
        <AnimatePresence mode="wait">
          {isLogin ? (
            <motion.div
              key="mascot"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{ marginBottom: 18 }}
            >
              <PrimeMascot size={64} eyes={eyes} decor={decor} wakeUp={wakeUp} />
            </motion.div>
          ) : (
            <motion.div
              key="logo"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{ marginBottom: 18 }}
            >
              <svg width="56" height="56" viewBox="0 0 1681 1681" fill="none" xmlns="http://www.w3.org/2000/svg">
                <motion.rect
                  x="58.8315" y="58.8315" width="1563.24" height="1563.24" rx="781.619"
                  stroke={FG} strokeWidth="117.663"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
                />
                <motion.path
                  d="M1344.73 840.43H336.186" stroke={FG} strokeWidth="117.663"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.05, ease: 'easeOut' }}
                />
                <motion.path
                  d="M840.469 1344.71L840.469 336.167" stroke={FG} strokeWidth="117.663"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
                />
                <motion.path
                  d="M1078.16 602.734L602.734 1078.16" stroke={FG} strokeWidth="117.663"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, delay: 0.15, ease: 'easeOut' }}
                />
                <motion.path
                  d="M1078.16 1078.16L602.734 602.734" stroke={FG} strokeWidth="117.663"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, delay: 0.2, ease: 'easeOut' }}
                />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Заголовок — меняется в зависимости от шага */}
        <div style={{ minHeight: 28, marginBottom: 36 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step === 'choice' ? `choice-${mode}` : step}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              style={{
                fontFamily: M,
                fontSize: 20,
                fontWeight: 500,
                color: FG,
                textAlign: 'center',
              }}
            >
              {step === 'email' ? emailTitle : step === 'code' ? codeTitle : step === 'legacy' ? 'аккаунт до обновления' : choiceTitle}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Контент шагов — на десктопе рендерится здесь */}
        <div className="w-full" style={{ minHeight: isMobile ? 0 : 200, display: isMobile ? 'none' : undefined }}>
          <AnimatePresence mode="wait">

            {/* ── CHOICE: выбор Google / Email ── */}
            {step === 'choice' && (
              <motion.div
                key={`choice-${mode}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="w-full flex flex-col items-center gap-4"
              >
                {/* На десктопе — карточка прямо здесь */}
                {!isMobile && (
                  <>
                    <div
                      className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                      style={{
                        background: 'rgba(255,255,255,0.5)',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
                      }}
                    >
                      <motion.button
                        type="button"
                        onClick={handleYandexClick}
                        disabled={yandex.loading || !yandex.ready || blockAuth}
                        whileHover={!yandex.loading ? { scale: 1.01, boxShadow: '0 4px 14px rgba(0,0,0,0.15)' } : undefined}
                        whileTap={!yandex.loading ? { scale: 0.97 } : undefined}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        className="w-full h-[52px] rounded-full flex items-center justify-center disabled:opacity-60"
                        style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8', border: 'none', cursor: yandex.loading ? 'default' : 'pointer', position: 'relative' }}
                      >
                        {yandex.loading ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                            <YandexMark />
                            {isLogin ? 'Войти через Яндекс' : 'С помощью Яндекс'}
                          </span>
                        )}
                      </motion.button>

                      <motion.button
                        type="button"
                        disabled={blockAuth}
                        onClick={() => { setStep('email'); setError(''); }}
                        whileHover={!blockAuth ? { scale: 1.01, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' } : undefined}
                        whileTap={!blockAuth ? { scale: 0.97 } : undefined}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        className="w-full h-[52px] rounded-full flex items-center justify-center disabled:opacity-60"
                        style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: !blockAuth ? 'pointer' : 'default' }}
                      >
                        {isLogin ? 'Получить письмо с кодом' : 'По электронной почте'}
                      </motion.button>
                    </div>

                    {mode === 'signup' && <ConsentCheck agreed={agreed} setAgreed={setAgreed} />}

                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          className="rounded-2xl px-4 py-2 text-sm"
                          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.button
                      type="button"
                      onClick={() => navigate(crossLinkTarget)}
                      whileHover={{ color: FG }}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}
                    >
                      {crossLinkText}
                    </motion.button>
                    {isLogin && (
                      <motion.button
                        type="button"
                        onClick={() => { if (blockAuth) { setError('Поставь галочку согласия, чтобы продолжить'); return; } setStep('legacy'); setError(''); }}
                        whileHover={{ color: FG }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        style={{ fontFamily: M, fontSize: 12, color: 'rgba(11,13,16,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Аккаунт до обновления?
                      </motion.button>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* ── EMAIL: ввод email ── */}
            {step === 'email' && (
              <motion.form
                key="email-step"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                onSubmit={handleSendOtp}
                className="w-full flex flex-col items-center gap-4"
              >
                <div
                  className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
                  }}
                >
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="Твой email адрес"
                      autoComplete="email"
                      className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }}
                    />
                  </div>

                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={!isMobile && !loading ? { scale: 1.01, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' } : undefined}
                    whileTap={!loading ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading ? 'default' : 'pointer' }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Получить письмо с кодом
                  </motion.button>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="button"
                  onClick={() => { setStep('choice'); setError(''); }}
                  whileHover={!isMobile ? { color: FG } : undefined}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}
                >
                  Вернуться назад
                </motion.button>
              </motion.form>
            )}

            {/* ── CODE: ввод OTP ── */}
            {step === 'code' && (
              <motion.form
                key="code-step"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                onSubmit={(e) => handleVerifyOtp(e)}
                className="w-full flex flex-col items-center gap-4"
              >
                <div
                  className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
                  }}
                >
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
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
                        if (v.length === 6) {
                          setTimeout(() => handleVerifyOtp(undefined, v), 0);
                        }
                      }}
                      placeholder="6 значный код"
                      autoComplete="one-time-code"
                      className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }}
                    />
                  </div>

                  <motion.button
                    type="submit"
                    disabled={loading || otp.length !== 6}
                    whileHover={!isMobile && !loading && otp.length === 6 ? { scale: 1.01, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' } : undefined}
                    whileTap={!loading && otp.length === 6 ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading || otp.length !== 6 ? 'default' : 'pointer' }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Подтвердить
                  </motion.button>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-center gap-4 mt-1">
                  <motion.button
                    type="button"
                    onClick={() => { setStep('email'); setOtp(''); setError(''); }}
                    whileHover={!isMobile ? { color: FG } : undefined}
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Вернуться назад
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCooldown > 0 || loading}
                    whileHover={!isMobile && resendCooldown === 0 && !loading ? { color: FG } : undefined}
                    whileTap={resendCooldown === 0 && !loading ? { scale: 0.95 } : undefined}
                    transition={{ duration: 0.15 }}
                    style={{ fontFamily: M, fontSize: 13, color: resendCooldown > 0 ? 'rgba(11,13,16,0.25)' : 'rgba(11,13,16,0.5)', background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer' }}
                  >
                    {resendCooldown > 0 ? `Повторить через ${resendCooldown}с` : 'Отправить снова'}
                  </motion.button>
                </div>
              </motion.form>
            )}

            {/* ── LEGACY: вход для старых аккаунтов ── */}
            {step === 'legacy' && (
              <motion.form
                key="legacy-step"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                onSubmit={handleLegacyLogin}
                className="w-full flex flex-col items-center gap-4"
              >
                <div
                  className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.55)', textAlign: 'center', padding: '4px 8px 2px' }}>
                    Для старых аккаунтов. После входа привяжи email.
                  </div>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input
                      type="text"
                      value={legacyUsername}
                      onChange={e => setLegacyUsername(e.target.value)}
                      placeholder="Имя пользователя"
                      autoComplete="username"
                      className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }}
                    />
                  </div>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input
                      type="password"
                      value={legacyPassword}
                      onChange={e => setLegacyPassword(e.target.value)}
                      placeholder="Пароль"
                      autoComplete="current-password"
                      className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }}
                    />
                  </div>
                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={!isMobile && !loading ? { scale: 1.01, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' } : undefined}
                    whileTap={!loading ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading ? 'default' : 'pointer' }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Войти
                  </motion.button>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="button"
                  onClick={() => { setStep('choice'); setLegacyUsername(''); setLegacyPassword(''); setError(''); }}
                  whileHover={!isMobile ? { color: FG } : undefined}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Вернуться назад
                </motion.button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>
      </motion.div>

      {/* Мобиль: все шаги — прижаты к низу экрана */}
      {isMobile && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '0 24px',
            paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          }}
        >
          <AnimatePresence mode="wait">

            {/* ── CHOICE ── */}
            {step === 'choice' && (
              <motion.div
                key={`mob-choice-${mode}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
              >
                <div
                  className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}
                >
                  <motion.button
                    type="button"
                    onClick={handleYandexClick}
                    disabled={yandex.loading || !yandex.ready || blockAuth}
                    whileTap={!yandex.loading ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center disabled:opacity-60"
                    style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8', border: 'none', cursor: yandex.loading ? 'default' : 'pointer', position: 'relative' }}
                  >
                    {yandex.loading ? <Loader2 size={18} className="animate-spin" /> : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <YandexMark />
                        {isLogin ? 'Войти через Яндекс' : 'С помощью Яндекс'}
                      </span>
                    )}
                  </motion.button>
                  <motion.button
                    type="button"
                    disabled={blockAuth}
                    onClick={() => { setStep('email'); setError(''); }}
                    whileTap={!blockAuth ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: !blockAuth ? 'pointer' : 'default' }}
                  >
                    {isLogin ? 'Получить письмо с кодом' : 'По электронной почте'}
                  </motion.button>
                </div>
                {mode === 'signup' && <ConsentCheck agreed={agreed} setAgreed={setAgreed} />}
                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}>
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button type="button" onClick={() => navigate(crossLinkTarget)} whileTap={{ scale: 0.95 }} transition={{ duration: 0.15 }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {crossLinkText}
                </motion.button>
                {isLogin && (
                  <motion.button type="button" onClick={() => { if (blockAuth) { setError('Поставь галочку согласия, чтобы продолжить'); return; } setStep('legacy'); setError(''); }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.15 }}
                    style={{ fontFamily: M, fontSize: 12, color: 'rgba(11,13,16,0.3)', background: 'none', border: 'none', cursor: 'pointer', marginTop: -4 }}>
                    Аккаунт до обновления?
                  </motion.button>
                )}
              </motion.div>
            )}

            {/* ── EMAIL ── */}
            {step === 'email' && (
              <motion.form
                key="mob-email"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                onSubmit={handleSendOtp}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
              >
                <div className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="Твой email адрес" autoComplete="email" className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }} />
                  </div>
                  <motion.button type="submit" disabled={loading}
                    whileTap={!loading ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading ? 'default' : 'pointer' }}>
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Получить письмо с кодом
                  </motion.button>
                </div>
                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}>
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button type="button" onClick={() => { setStep('choice'); setError(''); }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.15 }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Вернуться назад
                </motion.button>
              </motion.form>
            )}

            {/* ── CODE ── */}
            {step === 'code' && (
              <motion.form
                key="mob-code"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                onSubmit={(e) => handleVerifyOtp(e)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
              >
                <div className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input ref={otpRef} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                      value={otp} onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setOtp(v);
                        if (v.length === 6) setTimeout(() => handleVerifyOtp(undefined, v), 0);
                      }}
                      placeholder="6 значный код" autoComplete="one-time-code" className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }} />
                  </div>
                  <motion.button type="submit" disabled={loading || otp.length !== 6}
                    whileTap={!loading && otp.length === 6 ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading || otp.length !== 6 ? 'default' : 'pointer' }}>
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Подтвердить
                  </motion.button>
                </div>
                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}>
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <motion.button type="button" onClick={() => { setStep('email'); setOtp(''); setError(''); }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.15 }}
                    style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Вернуться назад
                  </motion.button>
                  <motion.button type="button" onClick={handleResend} disabled={resendCooldown > 0 || loading}
                    whileTap={resendCooldown === 0 && !loading ? { scale: 0.95 } : undefined} transition={{ duration: 0.15 }}
                    style={{ fontFamily: M, fontSize: 13, color: resendCooldown > 0 ? 'rgba(11,13,16,0.25)' : 'rgba(11,13,16,0.5)', background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer' }}>
                    {resendCooldown > 0 ? `Повторить через ${resendCooldown}с` : 'Отправить снова'}
                  </motion.button>
                </div>
              </motion.form>
            )}

            {/* ── LEGACY ── */}
            {step === 'legacy' && (
              <motion.form
                key="mob-legacy"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                onSubmit={handleLegacyLogin}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
              >
                <div className="w-full rounded-[28px] px-2.5 pt-2.5 pb-2.5 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 16px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.55)', textAlign: 'center', padding: '4px 8px 2px' }}>
                    Для старых аккаунтов. После входа привяжи email.
                  </div>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input type="text" value={legacyUsername} onChange={e => setLegacyUsername(e.target.value)}
                      placeholder="Имя пользователя" autoComplete="username" className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }} />
                  </div>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6 input-row" style={{ background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <input type="password" value={legacyPassword} onChange={e => setLegacyPassword(e.target.value)}
                      placeholder="Пароль" autoComplete="current-password" className="w-full bg-transparent outline-none"
                      style={{ fontFamily: M, fontSize: '0.95rem', color: FG }} />
                  </div>
                  <motion.button type="submit" disabled={loading}
                    whileTap={!loading ? { scale: 0.97 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG, border: '1px solid rgba(0,0,0,0.1)', cursor: loading ? 'default' : 'pointer' }}>
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Войти
                  </motion.button>
                </div>
                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-2xl px-4 py-2 text-sm"
                      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', fontFamily: F }}>
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button type="button" onClick={() => { setStep('choice'); setLegacyUsername(''); setLegacyPassword(''); setError(''); }}
                  whileTap={{ scale: 0.95 }} transition={{ duration: 0.15 }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Вернуться назад
                </motion.button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
