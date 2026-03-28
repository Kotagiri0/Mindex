import React, { useState } from 'react';
import { X, User, Camera, ChevronRight } from 'lucide-react';
import { Settings } from '../types';
import { db } from '../lib/db';

interface SettingsProps {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onBack: () => void;
}

export default function SettingsScreen({ settings, setSettings, onBack }: SettingsProps) {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

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
            className="w-[54px] h-[54px] rounded-full bg-gradient-to-br from-accent to-[#a56bff] flex-shrink-0 overflow-hidden cursor-pointer relative flex items-center justify-center group"
          >
            {settings.avatar ? (
              <img src={settings.avatar} className="absolute inset-0 w-full h-full object-cover rounded-full" />
            ) : (
              <User size={22} className="text-white/80" />
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={16} color="white" />
            </div>
          </div>
          <input type="file" id="av-inp" className="hidden" accept="image/*" onChange={handleAvatar} />
          
          <div className="flex-1">
            <div className="text-[17px] font-bold text-text-primary">
              {settings.name || 'Как вас зовут?'}
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
