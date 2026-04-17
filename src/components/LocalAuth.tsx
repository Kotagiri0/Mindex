import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { LocalUser } from '../types';
import { loginGoogleUser, loginLocalUser, registerLocalUser } from '../lib/auth';

interface LocalAuthProps {
  onAuthenticated: (user: LocalUser) => void;
}

type Mode = 'login' | 'register';

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

const MysliLogo = () => (
  <svg width="72" height="72" viewBox="0 0 168 168" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="84" cy="84" r="78" stroke="#0b0d10" strokeWidth="11.766"/>
    <g transform="translate(84,84) rotate(45)">
      <line x1="0" y1="-44" x2="0" y2="44" stroke="#0b0d10" strokeWidth="8" strokeLinecap="round"/>
      <line x1="-44" y1="0" x2="44" y2="0" stroke="#0b0d10" strokeWidth="8" strokeLinecap="round"/>
      <line x1="-31" y1="-31" x2="31" y2="31" stroke="#0b0d10" strokeWidth="8" strokeLinecap="round"/>
      <line x1="31" y1="-31" x2="-31" y2="31" stroke="#0b0d10" strokeWidth="8" strokeLinecap="round"/>
    </g>
  </svg>
);

const GoogleMark = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.2 33.9 29.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.3 0 6.3 1.2 8.6 3.2l5.7-5.7C34.4 5.9 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.2-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.9C14.8 15.4 19 12 24 12c3.3 0 6.3 1.2 8.6 3.2l5.7-5.7C34.4 5.9 29.5 4 24 4 16 4 9.1 8.5 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.4 0 10.4-2 14.2-5.2l-6.6-5.5C29.4 34.9 26.8 36 24 36c-5.1 0-9.1-3.2-10.7-7.6l-6.6 5.1C9.4 39.5 16.1 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 2.9-3.1 5.2-5.7 6.8l.1-.1 6.6 5.5C36.8 38.8 44 33.2 44 24c0-1.3-.1-2.2-.4-3.5z"/>
  </svg>
);

export default function LocalAuth({ onAuthenticated }: LocalAuthProps) {
  const [mode, setMode] = useState<Mode>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string>(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (googleClientId) return;
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) return;
        const data = await response.json().catch(() => null) as { googleClientId?: string } | null;
        if (!cancelled && data?.googleClientId) setGoogleClientId(data.googleClientId);
      } catch { /* silent */ }
    };
    loadConfig();
    return () => { cancelled = true; };
  }, [googleClientId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || googleLoading) return;
    setError('');
    setLoading(true);
    try {
      const user = mode === 'register'
        ? await registerLocalUser({ username, password, displayName })
        : await loginLocalUser({ username, password });
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить вход.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;
    let cancelled = false;
    const renderGoogleButton = async () => {
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
            } catch (authError) {
              setError(authError instanceof Error ? authError.message : 'Не удалось войти через Google.');
            } finally {
              setGoogleLoading(false);
            }
          },
        });
        googleButtonRef.current.innerHTML = '';
        const width = Math.min(Math.max(googleButtonRef.current.getBoundingClientRect().width || 320, 280), 360);
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width, logo_alignment: 'center',
        });
      } catch (authError) {
        if (!cancelled) setError(authError instanceof Error ? authError.message : 'Не удалось загрузить Google вход.');
      }
    };
    renderGoogleButton();
    return () => {
      cancelled = true;
      if (googleButtonRef.current) googleButtonRef.current.innerHTML = '';
    };
  }, [googleClientId, onAuthenticated]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-6 py-10"
      style={{ backgroundColor: '#f0f0f0' }}
    >
      {/* Лого */}
      <div className="flex flex-col items-center gap-3 mt-16">
        <MysliLogo />
        <span
          className="text-[#0b0d10] tracking-widest uppercase"
          style={{
            fontFamily: "'Random Grotesque', sans-serif",
            fontSize: '2.6rem',
            fontWeight: 400,
            letterSpacing: '0.15em',
          }}
        >
          мысль
        </span>
      </div>

      {/* Форма */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="w-full max-w-[440px]"
      >
          <div className="w-full flex flex-col gap-3">
            {/* Переключатель */}
            <div
              className="flex w-full rounded-full p-1"
              style={{ background: '#ffffff', border: '1.5px solid rgba(0,0,0,0.08)' }}
            >
              {(['register', 'login'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(''); }}
                  className="relative flex-1 h-11 rounded-full transition-all duration-200"
                  style={{
                    fontFamily: "'Random Grotesque', sans-serif",
                    fontSize: '1rem',
                    fontWeight: 400,
                    color: mode === m ? 'rgba(11,13,16,0.8)' : 'rgba(11,13,16,0.5)',
                    background: mode === m ? 'rgba(255,255,255,0.8)' : 'transparent',
                  }}
                >
                  {m === 'register' ? 'регистрация' : 'вход'}
                </button>
              ))}
            </div>

            {/* Поле имени */}
            <div
              className="w-full h-14 rounded-[24px] flex items-center px-5"
              style={{
                background: '#ffffff',
                border: '1.5px solid rgba(0,0,0,0.1)',
              }}
            >
              <input
                value={mode === 'register' ? displayName : username}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  mode === 'register' ? setDisplayName(e.target.value) : setUsername(e.target.value)
                }
                placeholder="Как вас называют?"
                className="w-full bg-transparent outline-none"
                style={{
                  fontFamily: "'Random Grotesque', sans-serif",
                  fontSize: '1rem',
                  fontWeight: 400,
                  color: 'rgba(11,13,16,0.8)',
                }}
                autoComplete={mode === 'register' ? 'name' : 'username'}
              />
            </div>

            {/* Поле username при регистрации */}
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 56 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="w-full rounded-[24px] flex items-center px-5 overflow-hidden"
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid rgba(0,0,0,0.1)',
                  }}
                >
                  <input
                    value={username}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                    placeholder="Имя пользователя"
                    className="w-full bg-transparent outline-none"
                    style={{
                      fontFamily: "'Random Grotesque', sans-serif",
                      fontSize: '1rem',
                      fontWeight: 400,
                      color: 'rgba(11,13,16,0.8)',
                    }}
                    autoComplete="username"
                    required
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Поле пароля */}
            <div
              className="w-full h-14 rounded-[24px] flex items-center px-5"
              style={{
                background: '#ffffff',
                border: '1.5px solid rgba(0,0,0,0.1)',
              }}
            >
              <input
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                placeholder="Пароль, минимум 4 символа"
                type="password"
                className="w-full bg-transparent outline-none"
                style={{
                  fontFamily: "'Random Grotesque', sans-serif",
                  fontSize: '1rem',
                  fontWeight: 400,
                  color: 'rgba(11,13,16,0.8)',
                }}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {/* Ошибка */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl px-4 py-2 text-sm"
                  style={{
                    background: 'rgba(220,38,38,0.08)',
                    border: '1px solid rgba(220,38,38,0.3)',
                    color: '#dc2626',
                    fontFamily: "'Random Grotesque', sans-serif",
                  }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Кнопка создать аккаунт / войти */}
            <button
              type="button"
              disabled={loading || googleLoading}
              className="w-full h-14 rounded-full flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{
                background: '#222224',
                fontFamily: "'Muller', sans-serif",
                fontSize: '1rem',
                fontWeight: 500,
                color: '#f8f8f8',
              }}
              onClick={() => {
                const syntheticEvent = { preventDefault: () => {} } as FormEvent<HTMLFormElement>;
                submit(syntheticEvent);
              }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
            </button>

            {/* Google вход */}
            {googleClientId ? (
              <div className="w-full flex flex-col items-center gap-2">
                <div ref={googleButtonRef} className="w-full flex items-center justify-center min-h-[56px]" />
                {googleLoading && (
                  <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'rgba(11,13,16,0.5)', fontFamily: "'Random Grotesque', sans-serif" }}
                  >
                    <Loader2 size={16} className="animate-spin" />
                    Проверяем аккаунт...
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled
                className="w-full h-14 rounded-full flex items-center justify-center gap-3 opacity-50"
                style={{
                  background: '#ffffff',
                  border: '1.5px solid rgba(0,0,0,0.1)',
                  fontFamily: "'Muller', sans-serif",
                  fontSize: '1rem',
                  fontWeight: 500,
                  color: '#222224',
                }}
              >
                <GoogleMark />
                Войти с помощью Google
              </button>
            )}

        </div>
      </motion.div>

      {/* Нижний отступ */}
      <div className="h-8" />
    </div>
  );
}
