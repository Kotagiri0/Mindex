import React, { useState, useEffect } from 'react';
import { X, User, Camera, ChevronRight, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Settings } from '../types';
import { db } from '../lib/db';

interface SettingsProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onBack: () => void;
}

export default function SettingsScreen({ settings, setSettings, onBack }: SettingsProps) {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [botStatus, setBotStatus] = useState<{ configured: boolean; info?: any; loading: boolean }>({ configured: false, loading: true });
  const [dbStatus, setDbStatus] = useState<{ configured: boolean; url?: string; loading: boolean }>({ configured: false, loading: true });

  useEffect(() => {
    checkBotStatus();
    checkDbStatus();
  }, []);

  const checkBotStatus = async () => {
    setBotStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/bot-status');
      const data = await res.json();
      setBotStatus({ configured: data.configured, info: data.info, loading: false });
    } catch (e) {
      setBotStatus({ configured: false, loading: false });
    }
  };

  const checkDbStatus = async () => {
    setDbStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/db-status');
      const data = await res.json();
      setDbStatus({ configured: data.configured, url: data.url, loading: false });
    } catch (e) {
      setDbStatus({ configured: false, loading: false });
    }
  };

  const setupBot = async () => {
    setBotStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/setup-bot');
      const data = await res.json();
      if (data.success) {
        setBotStatus({ configured: true, info: data.info, loading: false });
        alert('✅ Бот успешно настроен!');
      } else {
        alert(`❌ Ошибка: ${data.error}`);
        setBotStatus(prev => ({ ...prev, loading: false }));
      }
    } catch (e) {
      alert('❌ Не удалось связаться с сервером');
      setBotStatus(prev => ({ ...prev, loading: false }));
    }
  };

  // Простая проверка на админа
  const isAdmin = settings.email === 'vadimkosov7@gmail.com';

  const handleToggle = (key: keyof Settings) => {
    setSettings({ ...settings, [key]: !settings[key] });
  };

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    const n = prompt('Как тебя зовут?', settings.name || '');
    if (n !== null) {
      setSettings({ ...settings, name: n });
    }
  };

  const clearMemory = async () => {
    const threads = await db.getThreads();
    await Promise.all(threads.map(t => db.deleteThread(t.id)));
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="safe-top flex-shrink-0" />
      
      <div className="p-4 flex items-center gap-3.5 flex-shrink-0">
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-text-secondary active:bg-border transition-colors">
          <X size={18} />
        </button>
        <span className="text-[20px] font-extrabold text-text-primary">Настройки</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-[14px] mb-3.5 bg-surface rounded-[14px] p-4 flex items-center gap-3.5">
          <div 
            onClick={() => document.getElementById('av-inp')?.click()}
            className="w-[54px] h-[54px] rounded-full bg-surface2 flex-shrink-0 overflow-hidden cursor-pointer relative flex items-center justify-center group"
          >
            {settings.avatar ? (
              <img src={settings.avatar} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            ) : (
              <div className="w-full h-full bg-[#E5E5EA] flex items-center justify-center">
                <User size={22} className="text-[#8E8E93]" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={16} color="white" />
            </div>
          </div>
          <input type="file" id="av-inp" className="hidden" accept="image/*" onChange={handleAvatar} />
          
          <div className="flex-1">
            <div className="text-[17px] font-bold text-text-primary">
              {settings.name || 'Имя'}
            </div>
          </div>
          <button onClick={editName} className="w-8 h-8 rounded-full bg-surface2 flex items-center justify-center text-[13px]">
            ✏️
          </button>
        </div>

        <div className="mx-[14px] mb-3 bg-surface rounded-[14px] overflow-hidden">
          <SettingRow 
            title="Агентный режим" 
            desc="Насколько ИИ действует сам: от советов до автоматической организации"
            isOn={settings.agent}
            onToggle={() => handleToggle('agent')}
          />
          <SettingRow 
            title="Подтверждать действия ИИ" 
            desc="Если включено — события попадут в календарь только после твоего «Ок»"
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

        <div className="mx-[14px] mb-3 bg-surface rounded-[14px] overflow-hidden">
          <LinkRow title="Расскажи о себе" />
          <LinkRow title="Очистить память модели" onClick={() => setIsConfirmingClear(true)} />
          <LinkRow title="Как ИИ стоит себя вести?" />
          <LinkRow title="Обратная связь с нами" />
        </div>

        {/* Статус синхронизации для всех пользователей */}
        <div className="mx-[14px] mb-6 p-4 bg-surface rounded-[14px] border border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[15px] font-bold text-text-primary">Облачная синхронизация</div>
            {db.getUserId() && db.isInTelegram() && dbStatus.configured ? (
              <div className="flex items-center gap-1.5 text-green-500 text-[13px] font-bold">
                <CheckCircle2 size={16} />
                <span>Активна</span>
              </div>
            ) : (
              <button 
                onClick={() => window.location.reload()} 
                className="flex items-center gap-1.5 text-text-tertiary hover:text-text-primary transition-colors text-[13px] font-bold"
              >
                <AlertCircle size={16} />
                <span>Локальный режим (Обновить)</span>
              </button>
            )}
          </div>
          <div className="text-[12px] text-text-tertiary leading-relaxed">
            {db.getUserId() ? (
              dbStatus.configured ? 
              `Ваши данные привязаны к Telegram ID: ${db.getUserId()} и сохраняются в облаке.` :
              'Telegram ID найден, но облачное хранилище не настроено или недоступно. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Secrets проекта.'
            ) : (
              'Приложение открыто вне Telegram. Данные сохраняются только в памяти этого устройства.'
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="mx-[14px] mb-6 p-4 bg-surface rounded-[14px] border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[15px] font-bold text-text-primary">База данных (Supabase)</div>
              {dbStatus.loading ? (
                <RefreshCw size={16} className="animate-spin text-accent" />
              ) : dbStatus.configured ? (
                <CheckCircle2 size={18} className="text-green-500" />
              ) : (
                <AlertCircle size={18} className="text-red-500" />
              )}
            </div>

            <div className="text-[12px] text-text-tertiary mb-3">
              {dbStatus.loading ? 'Проверка...' : 
               dbStatus.configured ? 
               `Подключено к: ${dbStatus.url}` : 
               'База данных не настроена. Бот не сможет сохранять задачи.'}
            </div>

            {!dbStatus.configured && (
              <div className="p-3 bg-red-50 rounded-xl border border-red-100 mb-2">
                <div className="text-[11px] text-red-600 leading-relaxed">
                  <strong>Что делать?</strong> Добавьте <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code> в <strong>Settings → Secrets</strong> в панели AI Studio.
                </div>
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="mx-[14px] mb-6 p-4 bg-surface rounded-[14px] border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[15px] font-bold text-text-primary">Telegram Bot Setup</div>
              {botStatus.loading ? (
                <RefreshCw size={16} className="animate-spin text-accent" />
              ) : botStatus.configured && botStatus.info?.url ? (
                <CheckCircle2 size={18} className="text-green-500" />
              ) : (
                <AlertCircle size={18} className="text-red-500" />
              )}
            </div>

            <div className="text-[12px] text-text-tertiary mb-4">
              {botStatus.loading ? 'Проверка статуса...' : 
               botStatus.configured && botStatus.info?.url ? 
               `Бот подключен к: ${botStatus.info.url}` : 
               'Бот не настроен или вебхук не установлен.'}
            </div>
            
            <button 
              disabled={botStatus.loading}
              onClick={setupBot}
              className="w-full h-11 bg-accent text-white rounded-xl text-[14px] font-bold active:scale-95 transition-transform disabled:opacity-50 mb-4"
            >
              {botStatus.configured ? 'Переподключить бота' : 'Настроить бота'}
            </button>

            <div className="text-[12px] text-text-tertiary mb-2">
              Webhook URL (для @BotFather):
            </div>
            <div className="flex items-center gap-2 bg-surface2 p-2.5 rounded-xl border border-border/50">
              <code className="flex-1 text-[11px] text-accent font-mono break-all">
                {window.location.origin}/api/webhook
              </code>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/api/webhook`);
                  alert('URL скопирован!');
                }}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-[11px] font-bold active:scale-95 transition-transform"
              >
                Копировать
              </button>
            </div>
          </div>
        )}
        
        <div className="h-10" />
      </div>

      {isConfirmingClear && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-[24px] w-full max-w-[320px] p-6 flex flex-col gap-4">
            <div className="text-[19px] font-bold text-text-primary text-center">Очистить память?</div>
            <div className="text-[15px] text-text-tertiary text-center leading-relaxed">
              Это удалит все ваши переписки без возможности восстановления.
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
                className="h-12 bg-surface2 text-text-primary rounded-full font-bold text-[15px] active:scale-95 transition-transform"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({ title, desc, isOn, onToggle }: { title: string; desc: string; isOn: boolean; onToggle: () => void }) {
  return (
    <div className="p-[14px_16px] flex items-start gap-3 border-b border-border last:border-none">
      <div className="flex-1">
        <div className="text-[15px] font-semibold text-text-primary mb-0.5">{title}</div>
        <div className="text-[13px] text-text-tertiary leading-tight">{desc}</div>
      </div>
      <button 
        onClick={onToggle}
        className={`w-12 h-7 rounded-full relative transition-colors duration-250 mt-0.5 flex-shrink-0 ${isOn ? 'bg-accent' : 'bg-border'}`}
      >
        <div className={`absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-md transition-transform duration-250 ${isOn ? 'translate-x-[20px]' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function LinkRow({ title, onClick }: { title: string; onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="p-[15px_16px] text-[15px] font-medium text-text-primary border-b border-border last:border-none cursor-pointer flex items-center justify-between active:bg-surface2 transition-colors"
    >
      {title}
      <ChevronRight size={18} className="text-text-tertiary" />
    </div>
  );
}
