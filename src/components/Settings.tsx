import type { ChangeEvent, ReactNode } from 'react';
import { useState } from 'react';
import { X, User, Camera, AlertCircle, LogOut, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Settings } from '../types';
import { getCurrentUser } from '../lib/auth';
import { storage } from '../lib/storage';

interface SettingsProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onBack: () => void;
  onLogout: () => void;
}

export default function SettingsScreen({ settings, setSettings, onBack, onLogout }: SettingsProps) {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const handleToggle = (key: keyof Settings) => {
    setSettings({ ...settings, [key]: !settings[key] });
  };

  const handleAvatar = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as string;
      setSettings({ ...settings, avatar: data });
    };
    reader.readAsDataURL(file);
  };

  const editName = () => {
    const nextName = prompt('Как тебя зовут?', settings.name || '');
    if (nextName !== null) {
      setSettings({ ...settings, name: nextName });
    }
  };

  const clearMemory = async () => {
    const user = getCurrentUser();
    if (user) {
      storage.clearUserData(user.id);
    }
    window.location.reload();
  };

  const currentUser = getCurrentUser();

  return (
    <div className="flex flex-col h-full bg-bg transition-theme">
      <div className="safe-top flex-shrink-0" />

      <div className="p-4 flex items-center gap-3.5 flex-shrink-0">
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-text-secondary active:bg-border transition-colors">
          <X size={18} />
        </button>
        <span className="text-[20px] font-extrabold text-text-primary">Настройки</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-[14px] mb-3.5 bg-surface rounded-[14px] p-4 flex items-center gap-3.5 transition-colors border border-transparent hover:border-border">
          <div
            onClick={() => document.getElementById('av-inp')?.click()}
            className="w-[54px] h-[54px] rounded-full bg-surface2 flex-shrink-0 overflow-hidden cursor-pointer relative flex items-center justify-center group transition-colors"
          >
            {settings.avatar || currentUser?.avatarUrl ? (
              <img src={settings.avatar || currentUser?.avatarUrl} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            ) : (
              <div className="w-full h-full bg-surface2 flex items-center justify-center">
                <User size={22} className="text-text-tertiary" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={16} color="white" />
            </div>
          </div>
          <input type="file" id="av-inp" className="hidden" accept="image/*" onChange={handleAvatar} />

          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold text-text-primary truncate">
              {settings.name || 'Имя'}
            </div>
            <div className="text-[13px] text-text-tertiary truncate">
              {currentUser?.email || currentUser?.username || 'Локальный аккаунт'}
            </div>
          </div>
          <button onClick={editName} className="w-8 h-8 rounded-full bg-surface2 flex items-center justify-center text-[13px] hover:bg-border transition-colors">
            ✏️
          </button>
        </div>

        <div className="mx-[14px] mb-3 bg-surface rounded-[14px] overflow-hidden border border-border">
          <SettingRow
            title="Агентный режим"
            desc="Насколько ИИ действует сам: от советов до автоматической организации"
            isOn={settings.agent}
            onToggle={() => handleToggle('agent')}
          />
          <SettingRow
            title="Подтверждать действия ИИ"
            desc="Если включено, изменения попадут в список только после твоего подтверждения"
            isOn={settings.confirm}
            onToggle={() => handleToggle('confirm')}
          />
          <SettingRow
            title="Уведомления"
            desc="«Мысль» напомнит о задачах согласно планам и целям"
            isOn={settings.notifs}
            onToggle={() => handleToggle('notifs')}
          />
        </div>

        <div className="mx-[14px] mb-3 bg-surface rounded-[14px] overflow-hidden border border-border">
          <ActionRow title="Очистить локальные данные" icon={<Trash2 size={18} />} onClick={() => setIsConfirmingClear(true)} />
          <ActionRow title="Выйти из аккаунта" icon={<LogOut size={18} />} onClick={onLogout} />
        </div>

        <div className="mx-[14px] mb-6 p-4 bg-surface rounded-[14px] border border-border transition-colors">
          <div className="flex items-center gap-2 mb-2 text-[15px] font-bold text-text-primary">
            <AlertCircle size={18} className="text-accent" />
            Локальный режим
          </div>
          <div className="text-[12px] text-text-tertiary leading-relaxed space-y-2">
            <p>Все задачи, диалоги и настройки хранятся только в этом браузере.</p>
            <p>Если очистить данные браузера, приложение начнёт с нуля.</p>
          </div>
        </div>

        <div className="h-10" />
      </div>

      {isConfirmingClear && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-surface rounded-[24px] w-full max-w-[320px] p-6 flex flex-col gap-4 border border-border"
          >
            <div className="text-[19px] font-bold text-text-primary text-center">Очистить память?</div>
            <div className="text-[15px] text-text-tertiary text-center leading-relaxed">
              Это удалит все локальные задачи, переписки и настройки без возможности восстановления.
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={clearMemory}
                className="h-12 bg-red-500 text-white rounded-full font-bold text-[15px] active:scale-95 transition-transform"
              >
                Удалить всё
              </button>
              <button
                onClick={() => setIsConfirmingClear(false)}
                className="h-12 bg-surface2 text-text-primary rounded-full font-bold text-[15px] active:scale-95 transition-transform border border-border"
              >
                Отмена
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function SettingRow({ title, desc, isOn, onToggle }: { title: string; desc: string; isOn: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full p-[14px_16px] flex items-start gap-3 border-b border-border last:border-none text-left active:opacity-70 transition-opacity">
      <div className="flex-1">
        <div className="text-[15px] font-bold text-text-primary mb-1">{title}</div>
        <div className="text-[12px] text-text-tertiary leading-relaxed">{desc}</div>
      </div>
      <motion.div 
        animate={{ backgroundColor: isOn ? 'var(--accent)' : 'var(--border)' }}
        className="w-11 h-7 rounded-full p-1 transition-all"
      >
        <motion.div 
          animate={{ x: isOn ? 16 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="w-5 h-5 rounded-full bg-white shadow-sm dark:bg-gray-300"
        />
      </motion.div>
    </button>
  );
}

function ActionRow({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full p-[14px_16px] flex items-center gap-3 border-b border-border last:border-none text-left active:opacity-70 transition-opacity">
      <div className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-text-secondary transition-colors">
        {icon}
      </div>
      <div className="flex-1 text-[15px] font-bold text-text-primary">{title}</div>
    </button>
  );
}