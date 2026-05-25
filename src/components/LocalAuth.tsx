import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { LocalUser } from '../types';
import { loginGoogleUser, loginLocalUser } from '../lib/auth';
import { storage } from '../lib/storage';
import { useHashRoute } from '../lib/useHashRoute';
import PrimeMascot, { PrimeEyes, PrimeDecor } from './PrimeMascot';

interface LocalAuthProps {
  onAuthenticated: (user: LocalUser) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

const loadGoogleIdentityScript = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existingScript) {
      if (window.google?.accounts?.id) { resolve(); return; }
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Не удалось загрузить Google Sign-In.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не удалось загрузить Google Sign-In.'));
    document.head.appendChild(script);
  }).catch((error) => { googleScriptPromise = null; throw error; });

  return googleScriptPromise;
};

const F = "'Random Grotesque', sans-serif";
const M = "'Muller', sans-serif";
const BG = '#f0f0f0';
const FG = '#222224';

async function sendOtp(email: string): Promise<void> {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отправить код');
}

async function verifyOtp(email: string, otp: string): Promise<LocalUser> {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
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

  const [step, setStep] = useState<Step>('choice');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [legacyUsername, setLegacyUsername] = useState('');
  const [legacyPassword, setLegacyPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string>(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const [resendCooldown, setResendCooldown] = useState(0);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (googleClientId) return;
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d?.googleClientId) setGoogleClientId(d.googleClientId);
    }).catch(() => {});
  }, [googleClientId]);

  // Рендерим Google-кнопку всякий раз когда возвращаемся на choice
  useEffect(() => {
    if (step !== 'choice') return;
    if (!googleClientId || !googleButtonRef.current) return;
    let cancelled = false;
    const render = async () => {
      try {
        await loadGoogleIdentityScript();
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            if (!credential) { setError('Google не вернул токен авторизации.'); return; }
            setError('');
            setGoogleLoading(true);
            try {
              const user = await loginGoogleUser(credential);
              onAuthenticated(user);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Не удалось войти через Google.');
            } finally { setGoogleLoading(false); }
          },
        });
        googleButtonRef.current.innerHTML = '';
        const width = Math.min(Math.max(googleButtonRef.current.getBoundingClientRect().width || 320, 280), 360);
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'filled_black', size: 'large', text: mode === 'signup' ? 'signup_with' : 'signin_with', shape: 'pill', width, logo_alignment: 'center',
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить Google вход.');
      }
    };
    render();
    return () => { cancelled = true; if (googleButtonRef.current) googleButtonRef.current.innerHTML = ''; };
  }, [googleClientId, onAuthenticated, step, mode]);

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
      await sendOtp(trimmed);
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
      const user = await verifyOtp(email.trim().toLowerCase(), trimmedOtp);
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
      await sendOtp(email.trim().toLowerCase());
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
      className="min-h-screen flex flex-col items-center px-6"
      style={{ backgroundColor: BG, justifyContent: 'flex-start', paddingTop: '20vh' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-[440px] flex flex-col items-center"
        style={{ gap: 0 }}
      >
        {/* Маскот — единственный, не перемонтируется при смене шагов */}
        <div style={{ marginBottom: 20 }}>
          <PrimeMascot
            size={84}
            eyes={eyes}
            decor={decor}
            wakeUp={wakeUp}
          />
        </div>

        {/* Заголовок — меняется в зависимости от шага */}
        <div style={{ minHeight: 32, marginBottom: 80 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step === 'choice' ? `choice-${mode}` : step}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              style={{
                fontFamily: M,
                fontSize: 22,
                fontWeight: 500,
                color: FG,
                textAlign: 'center',
              }}
            >
              {step === 'email' ? emailTitle : step === 'code' ? codeTitle : step === 'legacy' ? 'Старый аккаунт' : choiceTitle}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Контент шагов */}
        <div className="w-full" style={{ minHeight: 200 }}>
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
                <div
                  className="w-full rounded-[32px] px-3 pt-3 pb-3 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
                >
                  {/* Google */}
                  {googleClientId ? (
                    <div className="w-full flex flex-col items-center">
                      <div ref={googleButtonRef} className="w-full flex items-center justify-center min-h-[52px]" />
                      {googleLoading && (
                        <div className="flex items-center gap-2 text-sm mt-1" style={{ color: 'rgba(11,13,16,0.5)', fontFamily: F }}>
                          <Loader2 size={14} className="animate-spin" />
                          Проверяем аккаунт...
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button" disabled
                      className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 opacity-50"
                      style={{ background: FG, fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: '#f8f8f8' }}
                    >
                      {isLogin ? 'Войти через Google' : 'С помощью Google'}
                    </button>
                  )}

                  {/* Email */}
                  <button
                    type="button"
                    onClick={() => { setStep('email'); setError(''); }}
                    className="w-full h-[52px] rounded-full flex items-center justify-center transition-opacity"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG }}
                  >
                    {isLogin ? 'Получить письмо с кодом' : 'По электронной почте'}
                  </button>
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

                {/* Кросс-ссылка вход ⇄ регистрация */}
                <button
                  type="button"
                  onClick={() => navigate(crossLinkTarget)}
                  style={{
                    fontFamily: M,
                    fontSize: 13,
                    color: 'rgba(11,13,16,0.4)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    marginTop: 4,
                  }}
                >
                  {crossLinkText}
                </button>

                {/* Скрытая ссылка на legacy-вход (только на /login) */}
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => { setStep('legacy'); setError(''); }}
                    style={{
                      fontFamily: M,
                      fontSize: 12,
                      color: 'rgba(11,13,16,0.3)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    У меня старый аккаунт
                  </button>
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
                  className="w-full rounded-[32px] px-3 pt-3 pb-3 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
                >
                  <div className="w-full h-[52px] rounded-full flex items-center px-6" style={{ background: '#f0f0f0' }}>
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

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Получить письмо с кодом
                  </button>
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

                <button
                  type="button"
                  onClick={() => { setStep('choice'); setError(''); }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}
                >
                  Вернуться назад
                </button>
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
                  className="w-full rounded-[32px] px-3 pt-3 pb-3 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
                >
                  <div className="w-full h-[52px] rounded-full flex items-center px-6" style={{ background: '#f0f0f0' }}>
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

                  <button
                    type="submit"
                    disabled={loading || otp.length !== 6}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Подтвердить
                  </button>
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
                  <button
                    type="button"
                    onClick={() => { setStep('email'); setOtp(''); setError(''); }}
                    style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Вернуться назад
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCooldown > 0 || loading}
                    style={{ fontFamily: M, fontSize: 13, color: resendCooldown > 0 ? 'rgba(11,13,16,0.25)' : 'rgba(11,13,16,0.5)', background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer' }}
                  >
                    {resendCooldown > 0 ? `Повторить через ${resendCooldown}с` : 'Отправить снова'}
                  </button>
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
                  className="w-full rounded-[32px] px-3 pt-3 pb-3 flex flex-col gap-2"
                  style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
                >
                  <div style={{ fontFamily: F, fontSize: 13, color: 'rgba(11,13,16,0.55)', textAlign: 'center', padding: '4px 8px 2px' }}>
                    Для старых аккаунтов. После входа привяжи email.
                  </div>
                  <div className="w-full h-[52px] rounded-full flex items-center px-6" style={{ background: '#f0f0f0' }}>
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
                  <div className="w-full h-[52px] rounded-full flex items-center px-6" style={{ background: '#f0f0f0' }}>
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
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-[52px] rounded-full flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
                    style={{ background: '#ffffff', fontFamily: M, fontSize: '0.95rem', fontWeight: 500, color: FG }}
                  >
                    {loading && <Loader2 size={16} className="animate-spin" />}
                    Войти
                  </button>
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

                <button
                  type="button"
                  onClick={() => { setStep('choice'); setLegacyUsername(''); setLegacyPassword(''); setError(''); }}
                  style={{ fontFamily: M, fontSize: 13, color: 'rgba(11,13,16,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Вернуться назад
                </button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
