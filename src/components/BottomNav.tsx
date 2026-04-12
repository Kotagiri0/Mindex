import React from 'react';
import { motion } from 'motion/react';
import { Home, MessageCircle } from 'lucide-react';
import { Screen } from '../types';
import { useTheme } from '../lib/theme';

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
  const { theme } = useTheme();
  const tabs = [
    { id: 'dash', icon: Home },
    { id: 'ai', icon: SparkleIcon },
    { id: 'threads', icon: MessageCircle },
  ];

  // Only show on main screens to avoid overlap with chat input
  if (!['dash', 'threads'].includes(activeScreen)) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-[340px]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-surface rounded-full p-1 flex items-center justify-between shadow-xl border border-border/50 h-[67px] backdrop-blur-sm transition-colors"
      >
        {tabs.map((tab) => {
          const isActive = activeScreen === tab.id;
          const isCenter = tab.id === 'ai';

          if (isCenter) {
            return (
              <motion.button
                key={tab.id}
                onClick={onNewThread}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.95 }}
                className="relative w-[85px] h-[85px] rounded-full bg-gradient-to-br from-accent to-accent/80 flex items-center justify-center shadow-2xl active:opacity-90 transition-all -mt-1.5 border-4 border-surface overflow-hidden group"
              >
                {/* Glowing effect */}
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-300/50 to-transparent opacity-0 group-hover:opacity-100 transition duration-300"
                />
                
                {/* Main glow */}
                <motion.div 
                  className="absolute inset-0 rounded-full"
                  style={{
                    boxShadow: '0 0 30px var(--glow-primary), 0 0 60px var(--glow-primary)'
                  }}
                  animate={{ 
                    boxShadow: [
                      '0 0 20px var(--glow-primary), 0 0 40px var(--glow-primary)',
                      '0 0 30px var(--glow-primary), 0 0 60px var(--glow-primary)',
                      '0 0 20px var(--glow-primary), 0 0 40px var(--glow-primary)'
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                />

                <SparkleIcon size={44} color="white" strokeWidth={0.5} className="relative z-10" />
                
                {/* Floating particles */}
                <motion.div 
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-white/10 -z-10"
                />
              </motion.button>
            );
          }

          return (
            <motion.button
              key={tab.id}
              onClick={() => onNavigate(tab.id as Screen)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="relative w-28 h-12 flex items-center justify-center rounded-full transition-all"
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-x-2 inset-y-0 bg-gradient-to-r from-accent/20 to-accent/10 rounded-full border border-accent/30"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <motion.div
                animate={{ scale: isActive ? 1.1 : 1 }}
                transition={{ duration: 0.2 }}
              >
                <tab.icon
                  size={26}
                  className={`relative z-10 transition-all duration-300 ${isActive ? 'text-accent' : 'text-text-tertiary'}`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </motion.div>
              
              {isActive && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute -inset-2 rounded-full"
                  style={{ boxShadow: 'inset 0 0 15px var(--glow-primary)' }}
                  transition={{ type: 'spring', bounce: 0.2 }}
                />
              )}
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
