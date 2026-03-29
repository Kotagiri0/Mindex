import React from 'react';
import { motion } from 'motion/react';
import { Home, MessageCircle } from 'lucide-react';
import { Screen } from '../types';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
}

const SparkleIcon = ({ size = 24, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C12 2 14 10 22 12C14 14 12 22 12 22C12 22 10 14 2 12C10 10 12 2 12 2Z" fill={color} />
  </svg>
);

export default function BottomNav({ activeScreen, onNavigate, onNewThread }: BottomNavProps) {
  const tabs = [
    { id: 'dash', icon: Home },
    { id: 'ai', icon: SparkleIcon },
    { id: 'threads', icon: MessageCircle },
  ];

  // Only show on main screens to avoid overlap with chat input
  if (!['dash', 'threads'].includes(activeScreen)) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-[340px]">
      <div className="bg-[#F2F2F7] rounded-full p-1.5 flex items-center justify-between shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-white/50">
        {tabs.map((tab) => {
          const isActive = activeScreen === tab.id;
          const isCenter = tab.id === 'ai';

          if (isCenter) {
            return (
              <button
                key={tab.id}
                onClick={onNewThread}
                className="relative w-20 h-20 rounded-full bg-[#4880FF] flex items-center justify-center shadow-[0_8px_24px_rgba(72,128,255,0.5)] active:scale-95 transition-all -mt-6 border-4 border-[#F2F2F7]"
              >
                <SparkleIcon size={44} color="white" />
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-white/20 -z-10"
                />
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id as Screen)}
              className="relative w-28 h-14 flex items-center justify-center"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-x-2 inset-y-1 bg-[#DCE7FF] rounded-full"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <tab.icon
                size={26}
                className={`relative z-10 transition-colors duration-300 ${isActive ? 'text-[#4880FF]' : 'text-[#3C3C43]/40'}`}
                strokeWidth={isActive ? 2.5 : 2}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
