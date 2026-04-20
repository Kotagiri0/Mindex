import { CalendarDays, MessageCircle, PenLine } from 'lucide-react';
import { motion } from 'motion/react';
import { Screen } from '../types';

interface BottomNavProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  onNewThread: () => void;
}

export default function BottomNav({ activeScreen, onNavigate, onNewThread }: BottomNavProps) {
  if (!['dash', 'threads'].includes(activeScreen)) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-between px-8"
      style={{
        background: '#f0f0f0',
        height: '72px',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid rgba(34,34,36,0.08)',
      }}
    >
      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={() => onNavigate('dash')}
        className="w-12 h-12 flex items-center justify-center"
      >
        <CalendarDays
          size={26}
          strokeWidth={activeScreen === 'dash' ? 2 : 1.5}
          color={activeScreen === 'dash' ? '#222224' : 'rgba(34,34,36,0.32)'}
        />
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={() => onNavigate('threads')}
        className="w-12 h-12 flex items-center justify-center"
      >
        <MessageCircle
          size={26}
          strokeWidth={activeScreen === 'threads' ? 2 : 1.5}
          color={activeScreen === 'threads' ? '#222224' : 'rgba(34,34,36,0.32)'}
        />
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={onNewThread}
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: '#222224' }}
      >
        <PenLine size={22} color="#ffffff" strokeWidth={1.75} />
      </motion.button>
    </div>
  );
}
