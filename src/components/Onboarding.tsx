import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface OnboardingProps {
  onComplete: () => void;
}

const steps = [
  {
    emoji: '🧠',
    label: 'Проблема',
    title: 'Миллионы пытаются привести мысли в порядок',
    desc: 'Инструменты продуктивности лишь повышают когнитивную нагрузку вместо того, чтобы снижать её',
    color: 'from-[#e8effe] to-[#c7d9ff]'
  },
  {
    emoji: '⚡',
    label: 'Решение',
    title: 'Майндекс меняет подход',
    desc: 'Не очередной планировщик — инструмент эффективности. ИИ организует мысли и действует за тебя',
    color: 'from-[#fce8f0] to-[#ffc7de]'
  },
  {
    emoji: '✨',
    label: 'Добро пожаловать',
    title: 'Просто скажи, что на уме',
    desc: 'Майндекс превратит мысли в задачи, напомнит о важном и поможет сфокусироваться на главном',
    color: 'from-[#e8f7ff] to-[#c7eaff]'
  }
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fafafa]">
      <div className="safe-top flex-shrink-0" />
      
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0 flex flex-col justify-center items-center px-7"
          >
            <div className={`w-[100px] h-[100px] rounded-[28px] mb-7 flex items-center justify-center text-[46px] bg-gradient-to-br ${steps[step].color}`}>
              {steps[step].emoji}
            </div>
            <div className="text-[12px] font-bold tracking-[1.5px] uppercase text-accent mb-2.5">
              {steps[step].label}
            </div>
            <div className="text-[24px] font-extrabold text-text-primary text-center leading-[1.25] mb-2.5">
              {steps[step].title}
            </div>
            <div className="text-[15px] text-text-secondary text-center leading-relaxed">
              {steps[step].desc}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-5 pb-[calc(28px+env(safe-area-inset-bottom,0px))] flex flex-col items-center gap-3 flex-shrink-0">
        <div className="flex gap-1.5 mb-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-250 ${
                i === step ? 'w-[22px] bg-accent' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
        <button
          onClick={handleNext}
          className="w-full h-[52px] bg-accent text-white rounded-[15px] font-bold text-[16px] active:opacity-85 transition-opacity"
        >
          {step === steps.length - 1 ? 'Начать →' : 'Далее →'}
        </button>
        <button
          onClick={onComplete}
          className="bg-none border-none text-[14px] text-text-tertiary cursor-pointer p-1"
        >
          Пропустить
        </button>
      </div>
    </div>
  );
}
