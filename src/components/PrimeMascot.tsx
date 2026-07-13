import { motion, AnimatePresence, useAnimationControls } from 'motion/react';
import { useEffect, useRef } from 'react';

/**
 * Маскот «Прайм» — круг с двумя глазами.
 * Пропорции 1:1 с prime_mascot.html (viewBox 70x70, всё через коэффициент S = size/70).
 */

export type PrimeEyes = 'waking' | 'down' | 'away' | 'idle';
export type PrimeDecor = 'none' | 'question' | 'dots';
export type PrimeDrop = 'none' | 'working' | 'needs' | 'done';

const FG = '#222224';

// Базовые координаты в системе viewBox 70x70 (как в prime_mascot.html)
const CX_BASE = 35;
const CY_BASE = 35;
const R_BASE = 32.55;
const SW_BASE = 4.9;
const EYE_LX_BASE = 29;
const EYE_RX_BASE = 41;
const EYE_W_BASE = SW_BASE;
const EYE_H_BASE = 17;
const EYE_TOP_BASE = 23;     // верх глаза в нейтральном состоянии
const EYE_BOTTOM_BASE = 40;  // низ глаза в нейтральном состоянии

interface EyeGeometry {
  x: number;       // горизонтальное смещение центра глаза
  y: number;       // вертикальное положение верха глаза
  h: number;       // высота глаза
  dx: number;      // оффсет влево/вправо (для 'away')
}

function getEyesGeometry(state: PrimeEyes): { left: EyeGeometry; right: EyeGeometry } {
  switch (state) {
    case 'waking':
    case 'idle':
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
      };
    case 'down':
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE + 5, h: EYE_H_BASE, dx: 0 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE + 5, h: EYE_H_BASE, dx: 0 },
      };
    case 'away':
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 3 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 3 },
      };
  }
}

interface PrimeMascotProps {
  size?: number;
  eyes: PrimeEyes;
  decor: PrimeDecor;
  /**
   * Если true и eyes='waking' — проигрывается пробуждение от закрытых глаз к открытым.
   * Только при первом маунте. Повторные смены eyes анимируются обычными transition-ами.
   */
  wakeUp?: boolean;
  /** Индикатор-«капля» в правом-верхнем углу: статус агента. */
  drop?: PrimeDrop;
}

const M = "'Muller', sans-serif";

export default function PrimeMascot({ size = 64, eyes, decor, wakeUp = false, drop = 'none' }: PrimeMascotProps) {
  const S = size / 70;
  const CX = CX_BASE * S;
  const CY = CY_BASE * S;
  const R = R_BASE * S;
  const SW = SW_BASE * S;
  const EYE_W = EYE_W_BASE * S;

  const leftCtrl = useAnimationControls();
  const rightCtrl = useAnimationControls();
  const initialized = useRef(false);

  // Проверяем prefers-reduced-motion один раз при маунте
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const reducedMotion = reducedMotionRef.current;

  // Анимируем глаза при каждой смене eyes
  useEffect(() => {
    const target = getEyesGeometry(eyes);
    const leftX = (target.left.x - EYE_W_BASE / 2 + target.left.dx) * S;
    const rightX = (target.right.x - EYE_W_BASE / 2 + target.right.dx) * S;

    if (!initialized.current && wakeUp) {
      // Первый маунт + пробуждение: стартуем с закрытых глаз и анимируем к target за 1.8s
      leftCtrl.set({ x: leftX, y: EYE_BOTTOM_BASE * S, height: 0 });
      rightCtrl.set({ x: rightX, y: EYE_BOTTOM_BASE * S, height: 0 });
      leftCtrl.start({
        x: leftX, y: target.left.y * S, height: target.left.h * S,
        transition: { duration: 1.8, ease: [0.215, 0.61, 0.355, 1] },
      });
      rightCtrl.start({
        x: rightX, y: target.right.y * S, height: target.right.h * S,
        transition: { duration: 1.8, ease: [0.215, 0.61, 0.355, 1] },
      });
    } else if (!initialized.current) {
      // Первый маунт без пробуждения: ставим сразу на target без анимации
      leftCtrl.set({ x: leftX, y: target.left.y * S, height: target.left.h * S });
      rightCtrl.set({ x: rightX, y: target.right.y * S, height: target.right.h * S });
    } else {
      // Повторные смены — плавный переход
      leftCtrl.start({
        x: leftX, y: target.left.y * S, height: target.left.h * S,
        transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] },
      });
      rightCtrl.start({
        x: rightX, y: target.right.y * S, height: target.right.h * S,
        transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] },
      });
    }
    initialized.current = true;
  }, [eyes, wakeUp, S, leftCtrl, rightCtrl]);

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx={CX} cy={CY} r={R} stroke={FG} strokeWidth={SW} fill="none" />
        <motion.rect fill={FG} width={EYE_W} animate={leftCtrl} />
        <motion.rect fill={FG} width={EYE_W} animate={rightCtrl} />
      </svg>

      {/* Декорация: ? или ... справа сверху от маскота */}
      <AnimatePresence>
        {decor !== 'none' && (
          <motion.div
            key={decor}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [-3, 0, -3] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 0.3 },
              y: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
            }}
            style={{
              position: 'absolute',
              top: -size * 0.18,
              right: -size * 0.2,
              fontFamily: M,
              fontSize: size * 0.28,
              fontWeight: 500,
              color: FG,
              lineHeight: 1,
              pointerEvents: 'none',
            }}
          >
            {decor === 'question' ? '?' : '…'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Капля-индикатор статуса агента, правый-верхний угол поверх обводки */}
      <AnimatePresence>
        {drop !== 'none' && (
          <motion.div
            key={drop}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'absolute',
              top: -size * 0.06,
              right: -size * 0.06,
              width: size * 0.3,
              height: size * 0.3,
              borderRadius: '50%',
              border: '3px solid #ECEBE8',
              boxSizing: 'border-box',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {drop === 'working' && (
              <motion.div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: 'conic-gradient(#9FDFAE 0 70%, transparent 70%)',
                }}
                animate={reducedMotion ? undefined : { rotate: 360 }}
                transition={reducedMotion ? undefined : { duration: 1.4, ease: 'linear', repeat: Infinity }}
              />
            )}
            {drop === 'needs' && (
              <motion.div
                style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#F5D879' }}
                animate={reducedMotion ? undefined : { scale: [1, 1.28, 1] }}
                transition={reducedMotion ? undefined : { duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
              />
            )}
            {drop === 'done' && (
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#9FDFAE' }} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
