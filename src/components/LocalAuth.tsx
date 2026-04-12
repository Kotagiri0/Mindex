import type { FormEvent } from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Lock, User, LogIn } from 'lucide-react';
import { LocalUser } from '../types';
import { loginLocalUser, registerLocalUser } from '../lib/auth';

interface LocalAuthProps {
  onAuthenticated: (user: LocalUser) => void;
}

type Mode = 'login' | 'register';

export default function LocalAuth({ onAuthenticated }: LocalAuthProps) {
  const [mode, setMode] = useState<Mode>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f8f4eb_0%,#f3efe6_40%,#ece6db_100%)] text-text-primary px-5 py-6 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-[420px] rounded-[28px] bg-white/80 backdrop-blur-xl border border-black/5 shadow-[0_24px_80px_rgba(34,24,14,0.12)] overflow-hidden"
      >
        <div className="p-6 pb-5 border-b border-black/5">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#f3e9d6] px-3 py-1 text-[12px] font-bold text-[#8a5c1d] mb-4">
            <Lock size={14} />
            Локальная версия
          </div>
          <h1 className="text-[30px] leading-[1.05] font-extrabold mb-3">Вход в Mindex</h1>
          <p className="text-[15px] leading-relaxed text-text-secondary">
            Аккаунт хранится только на этом устройстве. Без облака и без лишнего трения.
          </p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-2 mb-5 rounded-[18px] bg-black/5 p-1">
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`h-11 rounded-[14px] text-[14px] font-bold transition-colors ${mode === 'register' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'}`}
            >
              Регистрация
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`h-11 rounded-[14px] text-[14px] font-bold transition-colors ${mode === 'login' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'}`}
            >
              Вход
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-text-tertiary mb-2">Имя пользователя</span>
              <div className="flex items-center gap-3 rounded-[16px] bg-surface px-4 h-12 border border-border">
                <User size={18} className="text-text-tertiary" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="например, vadim"
                  className="w-full bg-transparent outline-none text-[15px] placeholder:text-text-tertiary"
                  autoComplete="username"
                  required
                />
              </div>
            </label>

            {mode === 'register' && (
              <label className="block">
                <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-text-tertiary mb-2">Как тебя называть</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Имя для интерфейса"
                  className="w-full rounded-[16px] bg-surface px-4 h-12 border border-border outline-none text-[15px] placeholder:text-text-tertiary"
                  autoComplete="name"
                />
              </label>
            )}

            <label className="block">
              <span className="block text-[12px] font-bold uppercase tracking-[0.12em] text-text-tertiary mb-2">Пароль</span>
              <div className="flex items-center gap-3 rounded-[16px] bg-surface px-4 h-12 border border-border">
                <Lock size={18} className="text-text-tertiary" />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 4 символа"
                  className="w-full bg-transparent outline-none text-[15px] placeholder:text-text-tertiary"
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                />
              </div>
            </label>

            {error && (
              <div className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] leading-relaxed text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-[16px] bg-accent text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-70"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
              {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
            </button>
          </form>

          <div className="mt-5 text-[13px] leading-relaxed text-text-secondary bg-surface2 rounded-[18px] p-4">
            Все задачи, переписки и настройки остаются в localStorage этого браузера. Если очистить данные браузера, всё удалится.
          </div>
        </div>
      </motion.div>
    </div>
  );
}