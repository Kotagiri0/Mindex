import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useRef } from 'react';

/**
 * Маскот «Прайм» — круг с двумя глазами.
 * Пропорции 1:1 с prime_mascot.html (viewBox 70x70, всё через коэффициент S = size/70).
 *
 * Состояния:
 *  - 'waking'  — пробуждение: глаза растут снизу вверх (для входа)
 *  - 'down'    — смотрит вниз (на поле email)
 *  - 'away'    — отводит взгляд в сторону (при вводе кода)
 *  - 'idle'    — нейтральное состояние (на регистрации)
 *
 * Декорации справа сверху:
 *  - 'question' — символ "?" с float-анимацией
 *  - 'dots'     — символ "..." с float-анимацией
 *  - 'none'     — без декорации
 */

export type PrimeEyes = 'waking' | 'down' | 'away' | 'idle';
export type PrimeDecor = 'none' | 'question' | 'dots';

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
      // Финальная фаза пробуждения — глаза на месте, открыты
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
      };
    case 'down':
      // Глаза смотрят вниз — опущены ниже на ~5 ед.
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE + 5, h: EYE_H_BASE, dx: 0 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE + 5, h: EYE_H_BASE, dx: 0 },
      };
    case 'away':
      // Глаза отведены в сторону (вправо) — оба глаза сдвинуты на +3 ед.
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 3 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 3 },
      };
    case 'idle':
    default:
      return {
        left:  { x: EYE_LX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
        right: { x: EYE_RX_BASE, y: EYE_TOP_BASE, h: EYE_H_BASE, dx: 0 },
      };
  }
}

interface PrimeMascotProps {
  size?: number;       // пиксели — диаметр канваса маскота
  eyes: PrimeEyes;
  decor: PrimeDecor;
  /**
   * Если true и eyes='waking' — проигрывается пробуждение от закрытых глаз к открытым
   * за 1800ms ease-out cubic. Используется один раз при появлении компонента.
   */
  wakeUp?: boolean;
}

const M = "'Muller', sans-serif";

export default function PrimeMascot({ size = 84, eyes, decor, wakeUp = false }: PrimeMascotProps) {
  const S = size / 70;
  const CX = CX_BASE * S;
  const CY = CY_BASE * S;
  const R = R_BASE * S;
  const SW = SW_BASE * S;
  const EYE_W = EYE_W_BASE * S;
  const target = getEyesGeometry(eyes);

  // Инициальное состояние для wakeUp: глаза «закрыты» в самом низу
  const initialEye = wakeUp
    ? { y: (EYE_BOTTOM_BASE) * S, h: 0 }   // глаз сжат у нижней линии
    : { y: target.left.y * S, h: target.left.h * S };

  const wakeRef = useRef(wakeUp);

  // После первого монтирования сбрасываем флаг wakeUp, чтобы повторные изменения eyes
  // анимировались обычными transition-ами, а не от «закрытого» состояния
  useEffect(() => { wakeRef.current = false; }, []);

  const transition = wakeUp
    ? { duration: 1.8, ease: [0.215, 0.61, 0.355, 1] as [number, number, number, number] } // ease-out cubic
    : { duration: 0.6, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Круг */}
        <circle cx={CX} cy={CY} r={R} stroke={FG} strokeWidth={SW} fill="none" />

        {/* Левый глаз */}
        <motion.rect
          fill={FG}
          width={EYE_W}
          initial={{
            x: (target.left.x - EYE_W_BASE / 2 + target.left.dx) * S,
            y: initialEye.y,
            height: initialEye.h,
          }}
          animate={{
            x: (target.left.x - EYE_W_BASE / 2 + target.left.dx) * S,
            y: target.left.y * S,
            height: target.left.h * S,
          }}
          transition={transition}
        />
        {/* Правый глаз */}
        <motion.rect
          fill={FG}
          width={EYE_W}
          initial={{
            x: (target.right.x - EYE_W_BASE / 2 + target.right.dx) * S,
            y: initialEye.y,
            height: initialEye.h,
          }}
          animate={{
            x: (target.right.x - EYE_W_BASE / 2 + target.right.dx) * S,
            y: target.right.y * S,
            height: target.right.h * S,
          }}
          transition={transition}
        />
      </svg>

      {/* Декорация: ? или ... справа сверху от маскота */}
      <AnimatePresence>
        {decor !== 'none' && (
          <motion.div
            key={decor}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [-4, 0, -4] }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 0.3 },
              y: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
            }}
            style={{
              position: 'absolute',
              top: -size * 0.12,
              right: -size * 0.16,
              fontFamily: M,
              fontSize: size * 0.22,
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
    </div>
  );
}
