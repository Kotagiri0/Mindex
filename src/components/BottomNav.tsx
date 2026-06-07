import { motion } from 'motion/react';
import { Screen } from '../types';
import { CalendarIcon, ChatIcon, ComposeIcon } from './icons';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
}

export default function BottomNav({ activeScreen, onNavigate, onNewThread }: BottomNavProps) {
  if (!['dash', 'threads'].includes(activeScreen)) return null;

  const activeTab = activeScreen === 'dash' ? 'dash' : activeScreen === 'threads' ? 'threads' : null;

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 160,
        background: 'linear-gradient(to top, #ffffff 50%, transparent)',
        zIndex: 99,
        pointerEvents: 'none',
      }} />
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
        background: '#ececec',
        borderRadius: 999,
        padding: 5,
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
                padding: '15px 12px',
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
                    boxShadow: '0 1px 5px rgba(0,0,0,0.08)',
                  }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1, display: 'flex' }}>
                {tab === 'dash'
                  ? <CalendarIcon size={26} color={isActive ? '#0B0D10' : '#9a9a9a'} />
                  : <ChatIcon size={26} color={isActive ? '#0B0D10' : '#9a9a9a'} />
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
          width: 58, height: 58,
          borderRadius: '50%',
          background: '#0B0D10',
          border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
        }}
      >
        <ComposeIcon size={25} color="#fff" />
      </motion.button>
    </div>
    </>
  );
}
