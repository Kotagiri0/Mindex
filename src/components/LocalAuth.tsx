import type { ChangeEvent, FormEvent } from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { LocalUser } from '../types';
import { loginLocalUser, registerLocalUser } from '../lib/auth';

interface LocalAuthProps {
  onAuthenticated: (user: LocalUser) => void;
}

type Mode = 'login' | 'register';

const MysliLogo = () => (
  <svg width="200" height="144" viewBox="0 0 419 302" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="131.436" y="5.883" width="156.324" height="156.324" rx="78.162" stroke="#222224" strokeWidth="11.766"/>
    <path d="M260.026 84.047H159.172" stroke="#222224" strokeWidth="11.766"/>
    <path d="M233.37 60.273L185.827 107.816" stroke="#222224" strokeWidth="11.766"/>
    <path d="M233.371 107.816L185.828 60.273" stroke="#222224" strokeWidth="11.766"/>
    <path d="M209.599 134.473L209.599 33.619" stroke="#222224" strokeWidth="11.766"/>
    <path d="M53.5967 266.473H43.8406L14.0784 218.433V266.473H6.42173V209.665H16.9188L48.6569 260.298L80.5186 209.665H90.8921V266.473H83.359V218.433L53.5967 266.473ZM173.883 209.665H181.416V266.473H173.883V209.665ZM111.765 259.063H136.711C150.624 259.063 157.581 255.564 157.581 248.566C157.581 241.074 150.501 237.328 136.34 237.328H111.765V259.063ZM111.765 209.665V229.918H137.575C145.89 229.918 152.559 231.565 157.581 234.858C162.603 238.151 165.114 242.762 165.114 248.689C165.114 254.37 162.768 258.775 158.075 261.903C153.382 264.95 146.714 266.473 138.069 266.473H104.108V209.665H111.765ZM262.107 228.066L255.191 229.424C253.133 224.567 249.758 220.862 245.065 218.31C240.454 215.675 234.773 214.358 228.022 214.358C219.295 214.358 212.503 216.416 207.646 220.533C202.788 224.567 200.36 230.33 200.36 237.822C200.36 245.396 202.788 251.242 207.646 255.358C212.503 259.392 219.295 261.409 228.022 261.409C235.185 261.409 241.195 260.01 246.053 257.211C250.91 254.329 254.039 250.336 255.438 245.232L262.601 246.59C260.872 253.506 256.879 258.857 250.622 262.644C244.365 266.431 236.832 268.325 228.022 268.325C217.237 268.325 208.634 265.649 202.212 260.298C195.79 254.946 192.579 247.454 192.579 237.822C192.579 228.272 195.79 220.862 202.212 215.593C208.634 210.241 217.237 207.566 228.022 207.566C236.008 207.566 243.006 209.336 249.017 212.876C255.109 216.416 259.472 221.479 262.107 228.066ZM337.034 209.665V266.473H329.5V216.951H296.527V238.81C296.527 243.42 296.157 247.413 295.416 250.789C294.757 254.164 293.81 256.84 292.575 258.816C291.423 260.792 289.941 262.397 288.13 263.632C286.318 264.785 284.507 265.567 282.696 265.979C280.967 266.308 278.95 266.473 276.645 266.473H270.47V258.939H276.645C278.209 258.939 279.485 258.857 280.473 258.692C281.543 258.445 282.655 257.91 283.807 257.087C284.96 256.264 285.866 255.111 286.524 253.629C287.265 252.065 287.841 249.924 288.253 247.207C288.747 244.491 288.994 241.239 288.994 237.451V209.665H337.034ZM357.669 259.063H383.973C398.628 259.063 405.955 255.564 405.955 248.566C405.955 241.074 398.504 237.328 383.603 237.328H357.669V259.063ZM357.669 209.665V229.918H384.838C393.482 229.918 400.398 231.565 405.585 234.858C410.854 238.151 413.488 242.762 413.488 248.689C413.488 254.37 411.06 258.775 406.202 261.903C401.345 264.95 394.388 266.473 385.332 266.473H350.012V209.665H357.669Z" fill="#222224"/>
  </svg>
);

export default function LocalAuth({ onAuthenticated }: LocalAuthProps) {
  const [mode, setMode] = useState<Mode>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (loading) return;
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
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-10"
      style={{ backgroundColor: '#f0f0f0' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="w-full max-w-[440px] flex flex-col items-center gap-6"
      >
        <MysliLogo />

        <form
          onSubmit={submit}
          className="w-full rounded-[32px] px-4 pt-4 pb-5 flex flex-col gap-3"
          style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
        >
          {/* Переключатель */}
          <div
            className="flex w-full rounded-full p-1"
            style={{ background: 'rgba(0,0,0,0.06)' }}
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
                  color: mode === m ? 'rgba(11,13,16,0.9)' : 'rgba(11,13,16,0.5)',
                  background: mode === m ? '#ffffff' : 'transparent',
                  boxShadow: mode === m ? '0 1px 6px rgba(0,0,0,0.14)' : 'none',
                }}
              >
                {m === 'register' ? 'регистрация' : 'вход'}
              </button>
            ))}
          </div>

          {/* Имя / логин */}
          <div
            className="w-full h-14 rounded-[24px] flex items-center px-5"
            style={{ background: '#ffffff', border: '1.5px solid rgba(0,0,0,0.1)' }}
          >
            <input
              value={mode === 'register' ? displayName : username}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                mode === 'register' ? setDisplayName(e.target.value) : setUsername(e.target.value)
              }
              placeholder={mode === 'register' ? 'Как тебя зовут?' : 'Имя пользователя'}
              className="w-full bg-transparent outline-none"
              style={{ fontFamily: "'Random Grotesque', sans-serif", fontSize: '1rem', color: 'rgba(11,13,16,0.8)' }}
              autoComplete={mode === 'register' ? 'name' : 'username'}
            />
          </div>

          {/* Username при регистрации */}
          <AnimatePresence>
            {mode === 'register' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 56 }}
                exit={{ opacity: 0, height: 0 }}
                className="w-full rounded-[24px] flex items-center px-5 overflow-hidden"
                style={{ background: '#ffffff', border: '1.5px solid rgba(0,0,0,0.1)' }}
              >
                <input
                  value={username}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                  placeholder="Имя для ИИ"
                  className="w-full bg-transparent outline-none"
                  style={{ fontFamily: "'Random Grotesque', sans-serif", fontSize: '1rem', color: 'rgba(11,13,16,0.8)' }}
                  autoComplete="username"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Пароль */}
          <div
            className="w-full h-14 rounded-[24px] flex items-center px-5"
            style={{ background: '#ffffff', border: '1.5px solid rgba(0,0,0,0.1)' }}
          >
            <input
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder="Пароль, минимум 4 символа"
              type="password"
              className="w-full bg-transparent outline-none"
              style={{ fontFamily: "'Random Grotesque', sans-serif", fontSize: '1rem', color: 'rgba(11,13,16,0.8)' }}
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

          {/* Кнопка */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-full flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
            style={{
              background: '#222224',
              fontFamily: "'Muller', sans-serif",
              fontSize: '1rem',
              fontWeight: 500,
              color: '#f8f8f8',
            }}
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
