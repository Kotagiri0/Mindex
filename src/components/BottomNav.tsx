import { motion } from 'motion/react';
import { Screen } from '../types';
import { CalendarIcon, NoteIcon, ComposeIcon } from './icons';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
}

export default function BottomNav({ activeScreen, onNavigate, onNewThread }: BottomNavProps) {
  if (!['dash', 'threads'].includes(activeScreen)) return null;

  const activeTab = activeScreen === 'dash' ? 'dash' : activeScreen === 'threads' ? 'threads' : null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
      left: 16,
      right: 16,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        background: '#e8e8e8',
        borderRadius: 999,
        padding: 6,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        {(['dash', 'threads'] as const).map(tab => {
          const isActive = activeTab === tab;
          return (
            <motion.button
              key={tab}
              onClick={() => onNavigate(tab)}
              whileTap={{ scale: 0.9 }}
              style={{
                position: 'relative',
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '12px 12px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  style={{
                    position: 'absolute', inset: 0,
                    background: '#ffffff',
                    borderRadius: 999,
                  }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1, display: 'flex' }}>
                {tab === 'dash'
                  ? <CalendarIcon size={21} color={isActive ? '#111' : '#bbb'} />
                  : <NoteIcon size={21} color={isActive ? '#111' : '#bbb'} />
                }
              </span>
            </motion.button>
          );
        })}
      </div>

      <motion.button
        onClick={() => onNavigate('today')}
        whileTap={{ scale: 0.92 }}
        style={{
          width: 54, height: 54,
          borderRadius: '50%',
          background: '#111',
          border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        }}
      >
        <ComposeIcon size={22} color="#fff" />
      </motion.button>
    </div>
  );
}
