import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Lock, User, LogIn, Sparkles } from 'lucide-react';
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
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');

    if (existingScript) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

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
  }).catch((error) => {
    googleScriptPromise = null;
    throw error;
  });

  return googleScriptPromise;
};

const GoogleMark = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.2 33.9 29.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.3 0 6.3 1.2 8.6 3.2l5.7-5.7C34.4 5.9 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.2-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.9C14.8 15.4 19 12 24 12c3.3 0 6.3 1.2 8.6 3.2l5.7-5.7C34.4 5.9 29.5 4 24 4 16 4 9.1 8.5 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.4 0 10.4-2 14.2-5.2l-6.6-5.5C29.4 34.9 26.8 36 24 36c-5.1 0-9.1-3.2-10.7-7.6l-6.6 5.1C9.4 39.5 16.1 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 2.9-3.1 5.2-5.7 6.8l.1-.1 6.6 5.5C36.8 38.8 44 33.2 44 24c0-1.3-.1-2.2-.4-3.5z" />
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
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading || googleLoading) {
      return;
    }

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
    if (!googleClientId || !googleButtonRef.current) {
      return;
    }

    let cancelled = false;

    const renderGoogleButton = async () => {
      try {
        await loadGoogleIdentityScript();

        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            if (!credential) {
              setError('Google не вернул токен авторизации.');
              return;
            }

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
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          width,
          logo_alignment: 'center',
        });
      } catch (authError) {
        if (!cancelled) {
          setError(authError instanceof Error ? authError.message : 'Не удалось загрузить Google вход.');
        }
      }
    };

    renderGoogleButton();

    return () => {
      cancelled = true;
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = '';
      }
    };
  }, [googleClientId, onAuthenticated]);

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-6 bg-gradient-to-br from-[#0a0f1f] via-[#1a1d2e] to-[#0f1419]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            top: ['0%', '50%', '0%'],
            left: ['0%', '50%', '0%'],
            opacity: [0.1, 0.3, 0.1]
          }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[#4880FF] to-transparent blur-3xl"
        />
        <motion.div 
          animate={{ 
            bottom: ['0%', '50%', '0%'],
            right: ['0%', '50%', '0%'],
            opacity: [0.1, 0.25, 0.1]
          }}
          transition={{ duration: 25, repeat: Infinity, delay: 2 }}
          className="absolute w-[400px] h-[400px] rounded-full bg-gradient-to-tl from-[#f5a623] to-transparent blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-[440px] relative z-10"
      >
        <div className="relative group">
          <motion.div 
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute -inset-1 bg-gradient-to-r from-[#4880FF] to-[#f5a623] rounded-[32px] blur opacity-50 group-hover:opacity-100 transition duration-1000"
          />
          
          <div className="relative rounded-[32px] bg-gradient-to-br from-[#1a1f3a] to-[#0f1419] backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden">
            <div className="relative p-8 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-[#4880FF]/20 to-transparent rounded-full blur-3xl"
              />
              
              <div className="relative">
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500/20 to-amber-500/20 px-4 py-2 text-sm font-bold text-[#6b9eff] mb-6 border border-blue-500/30"
                >
                  <Sparkles size={16} />
                  Персональный ИИ-планировщик
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-5xl leading-tight font-extrabold mb-3 bg-gradient-to-r from-white via-[#c5d9ff] to-[#ffd699] bg-clip-text text-transparent"
                >
                  Мысль
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-lg leading-relaxed text-gray-300"
                >
                  Введи текст — получи план. Никаких полей, никаких шаблонов.
                </motion.p>
              </div>
            </div>

            <div className="p-8 space-y-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="grid grid-cols-2 gap-3 rounded-2xl bg-white/5 p-1 border border-white/10"
              >
                {(['register', 'login'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`relative h-12 rounded-xl text-base font-bold transition-all duration-300 ${
                      mode === m
                        ? 'text-white'
                        : 'text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    {mode === m && (
                      <motion.div
                        layoutId="mode-indicator"
                        className="absolute inset-0 bg-gradient-to-r from-[#4880FF] to-[#6b9eff] rounded-xl"
                        transition={{ type: 'spring', bounce: 0.2 }}
                      />
                    )}
                    <span className="relative z-10">
                      {m === 'register' ? 'Регистрация' : 'Вход'}
                    </span>
                  </button>
                ))}
              </motion.div>

              <form onSubmit={submit} className="space-y-4">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 }}
                >
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 block">Имя пользователя</span>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-r from-[#4880FF]/50 to-[#6b9eff]/50 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300 blur" />
                      <div className="relative flex items-center gap-4 rounded-2xl bg-white/5 px-5 h-14 border border-white/10 group-focus-within:border-white/30 transition">
                        <User size={20} className="text-[#6b9eff] flex-shrink-0" />
                        <input
                          value={username}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                          placeholder="например, vadim"
                          className="w-full bg-transparent outline-none text-base text-white placeholder:text-gray-500 transition"
                          autoComplete="username"
                          required
                        />
                      </div>
                    </div>
                  </label>
                </motion.div>

                {mode === 'register' && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.65 }}
                  >
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 block">Как тебя называть</span>
                      <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-[#f5a623]/50 to-[#ffb84d]/50 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300 blur" />
                        <input
                          value={displayName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value)}
                          placeholder="Имя для интерфейса"
                          className="relative w-full rounded-2xl bg-white/5 px-5 h-14 border border-white/10 group-focus-within:border-white/30 outline-none text-base text-white placeholder:text-gray-500 transition"
                          autoComplete="name"
                        />
                      </div>
                    </label>
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: mode === 'register' ? 0.7 : 0.65 }}
                >
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 block">Пароль</span>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-r from-[#4880FF]/50 to-[#6b9eff]/50 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300 blur" />
                      <div className="relative flex items-center gap-4 rounded-2xl bg-white/5 px-5 h-14 border border-white/10 group-focus-within:border-white/30 transition">
                        <Lock size={20} className="text-[#6b9eff] flex-shrink-0" />
                        <input
                          value={password}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                          placeholder="Минимум 4 символа"
                          className="w-full bg-transparent outline-none text-base text-white placeholder:text-gray-500 transition"
                          type="password"
                          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                          required
                        />
                      </div>
                    </div>
                  </label>
                </motion.div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-red-500/50 bg-red-500/10 px-5 py-3 text-sm leading-relaxed text-red-400"
                  >
                    {error}
                  </motion.div>
                )}

                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: mode === 'register' ? 0.75 : 0.7 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading || googleLoading}
                  className="relative w-full h-14 rounded-2xl bg-gradient-to-r from-[#4880FF] to-[#6b9eff] text-white text-base font-bold flex items-center justify-center gap-3 overflow-hidden group disabled:opacity-70 transition-all"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-[#f5a623] to-[#ffb84d] opacity-0 group-hover:opacity-100 transition duration-500" />
                  <div className="relative z-10 flex items-center gap-3">
                    {loading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <LogIn size={20} />
                    )}
                    {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
                  </div>
                </motion.button>
              </form>

              <div className="relative flex items-center gap-3 text-gray-500 text-[12px] uppercase tracking-[0.2em]">
                <div className="h-px flex-1 bg-white/10" />
                <span>или</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 space-y-3">
                <div className="flex items-center gap-3 text-white font-semibold">
                  <GoogleMark />
                  <span>Войти через Google</span>
                </div>

                {googleClientId ? (
                  <>
                    <div ref={googleButtonRef} className="min-h-[44px] flex items-center justify-center" />
                    {googleLoading && (
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <Loader2 size={16} className="animate-spin" />
                        Проверяем Google-аккаунт...
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-gray-300 leading-relaxed">
                    Добавь переменную <span className="font-semibold text-white">VITE_GOOGLE_CLIENT_ID</span> в окружение, чтобы включить Google вход.
                  </div>
                )}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: mode === 'register' ? 0.8 : 0.75 }}
                className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-amber-500/10 p-4 text-sm leading-relaxed text-gray-300"
              >
                💾 Все данные хранятся только на этом устройстве. Без облака, без отслеживания, без лишних вопросов.
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
