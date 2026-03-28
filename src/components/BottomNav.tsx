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
    <path d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" fill={color} />
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
                className="relative w-16 h-16 rounded-full bg-[#4880FF] flex items-center justify-center shadow-[0_4px_16px_rgba(72,128,255,0.4)] active:scale-90 transition-transform"
              >
                <SparkleIcon size={32} color="white" />
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
