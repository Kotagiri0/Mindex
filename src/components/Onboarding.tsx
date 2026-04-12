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
    gradient: 'from-blue-100 to-blue-200 dark:from-blue-900/30 dark:to-blue-800/20'
  },
  {
    emoji: '⚡',
    label: 'Решение',
    title: 'Майндекс меняет подход',
    desc: 'Не очередной планировщик — инструмент эффективности. ИИ организует мысли и действует за тебя',
    gradient: 'from-purple-100 to-purple-200 dark:from-purple-900/30 dark:to-purple-800/20'
  },
  {
    emoji: '✨',
    label: 'Добро пожаловать',
    title: 'Просто скажи, что на уме',
    desc: 'Майндекс превратит мысли в задачи, напомнит о важном и поможет сфокусироваться на главном',
    gradient: 'from-cyan-100 to-cyan-200 dark:from-cyan-900/30 dark:to-cyan-800/20'
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
    <div className="flex flex-col h-full bg-bg transition-colors duration-300">
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
            <motion.div 
              className={`w-[100px] h-[100px] rounded-[28px] mb-7 flex items-center justify-center text-[46px] bg-gradient-to-br ${steps[step].gradient} shadow-lg`}
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.2 }}
            >
              {steps[step].emoji}
            </motion.div>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-[12px] font-bold tracking-[1.5px] uppercase text-accent mb-2.5"
            >
              {steps[step].label}
            </motion.div>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-[24px] font-extrabold text-text-primary text-center leading-[1.25] mb-2.5"
            >
              {steps[step].title}
            </motion.div>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-[15px] text-text-secondary text-center leading-relaxed"
            >
              {steps[step].desc}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-5 pb-[calc(28px+env(safe-area-inset-bottom,0px))] flex flex-col items-center gap-3 flex-shrink-0">
        <div className="flex gap-1.5 mb-2">
          {steps.map((_, i) => (
            <motion.div
              key={i}
              animate={{ 
                width: i === step ? 22 : 6,
                backgroundColor: i === step ? 'var(--accent)' : 'var(--border)'
              }}
              transition={{ duration: 0.3 }}
              className="h-1.5 rounded-full"
            />
          ))}
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleNext}
          className="w-full h-[52px] bg-gradient-to-r from-accent to-accent/90 text-white rounded-[15px] font-bold text-[16px] active:opacity-85 transition-opacity shadow-lg hover:shadow-xl"
        >
          {step === steps.length - 1 ? 'Начать →' : 'Далее →'}
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          onClick={onComplete}
          className="bg-none border-none text-[14px] text-text-tertiary cursor-pointer p-1 hover:text-text-secondary transition-colors"
        >
          Пропустить
        </motion.button>
      </div>
    </div>
  );
}
