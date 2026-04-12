import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, time: string, date: string) => void;
  initialDate: string;
}

export default function AddTaskModal({ isOpen, onClose, onAdd, initialDate }: AddTaskModalProps) {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [date, setDate] = useState(initialDate);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setTime('');
      setDate(initialDate);
    }
  }, [isOpen, initialDate]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onAdd(name, time, date);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative w-full bg-surface rounded-t-[22px] p-[18px_18px_calc(32px+env(safe-area-inset-bottom,0px))]"
          >
            <div className="w-9 h-1 bg-border rounded-full mx-auto mb-4" />
            <h3 className="text-[17px] font-bold mb-3.5">Новая задача</h3>
            
            <div className="mb-3">
              <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Название</label>
              <input
                autoFocus
                className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                placeholder="Что нужно сделать?"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex gap-2.5 mb-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Время</label>
                <input
                  type="time"
                  className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-text-tertiary mb-1 uppercase tracking-wider">Дата</label>
                <input
                  type="date"
                  className="w-full h-[46px] bg-surface2 border-[1.5px] border-transparent rounded-[12px] px-3.5 text-[15px] outline-none focus:border-accent focus:bg-surface transition-all text-text-primary"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full h-[50px] bg-accent text-white rounded-[13px] font-bold text-[16px] mt-1.5 active:opacity-85 transition-opacity"
            >
              Создать задачу
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
