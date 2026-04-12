import type { FormEvent } from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Lock, User, LogIn, Sparkles } from 'lucide-react';
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
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-6 bg-gradient-to-br from-[#0a0f1f] via-[#1a1d2e] to-[#0f1419]">
      {/* Animated background orbs */}
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

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-[440px] relative z-10"
      >
        <div className="relative group">
          {/* Glowing border effect */}
          <motion.div 
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute -inset-1 bg-gradient-to-r from-[#4880FF] to-[#f5a623] rounded-[32px] blur opacity-50 group-hover:opacity-100 transition duration-1000"
          />
          
          {/* Card content */}
          <div className="relative rounded-[32px] bg-gradient-to-br from-[#1a1f3a] to-[#0f1419] backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden">
            {/* Header with gradient */}
            <div className="relative p-8 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
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

            {/* Form content */}
            <div className="p-8 space-y-6">
              {/* Mode toggle */}
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

              {/* Form fields */}
              <form onSubmit={submit} className="space-y-4">
                {/* Username */}
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
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="например, vadim"
                          className="w-full bg-transparent outline-none text-base text-white placeholder:text-gray-500 transition"
                          autoComplete="username"
                          required
                        />
                      </div>
                    </div>
                  </label>
                </motion.div>

                {/* Display name (register only) */}
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
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Имя для интерфейса"
                          className="relative w-full rounded-2xl bg-white/5 px-5 h-14 border border-white/10 group-focus-within:border-white/30 outline-none text-base text-white placeholder:text-gray-500 transition"
                          autoComplete="name"
                        />
                      </div>
                    </label>
                  </motion.div>
                )}

                {/* Password */}
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
                          onChange={(e) => setPassword(e.target.value)}
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

                {/* Error */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-red-500/50 bg-red-500/10 px-5 py-3 text-sm leading-relaxed text-red-400"
                  >
                    {error}
                  </motion.div>
                )}

                {/* Submit button */}
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: mode === 'register' ? 0.75 : 0.7 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
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

              {/* Info box */}
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