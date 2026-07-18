import { motion, AnimatePresence, useAnimationControls } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Маскот «Мысль» — круг с двумя глазами-палочками.
 * Пропорции 1:1 с prime_mascot.html (viewBox 70x70, всё через коэффициент S = size/70).
 *
 * Пак настроений (mood) перенесён дословно из HTML-референса фаундера: mood управляет
 * анимацией глаз и корпуса, drop остаётся независимым слоем (капля-статус в углу).
 */

export type PrimeEyes = 'waking' | 'down' | 'away' | 'idle';
export type PrimeDecor = 'none' | 'question' | 'dots';
export type PrimeDrop = 'none' | 'working' | 'needs' | 'done';

/**
 * Настроения маскота «Мысль»:
 * - idle — дыхание (scale 1→1.022, 4.6s) + редкое моргание (~раз в 5.2s)
 * - listening — глаза приподняты на 15%, лёгкий наклон корпуса ±4° (2.6s), кольцо-пульс вовне
 * - thinking — взгляд уходит вверх-вбок рывками (цикл 3.4s), корпус неподвижен
 * - working — глаза-«сканер» выше и ходят влево-вправо ±3px (1.5s)
 * - ask — левый глаз периодически прищуривается (1.9s), корпус — редкий толчок-наклон (3.5s)
 * - done — глаза-дуги «прищур», одна мягкая подпрыжка корпуса (2.8s)
 * - celebrate — глаза-дуги + двойная подпрыжка (2.4s) + 6 конфетти-частиц.
 *   Использовать ≤1 раза в день — это ответственность вызывающего кода, компонент не ограничивает частоту.
 * - oops — глаза вниз и уже (−30% высоты), медленный «вздох» корпуса (3.6s)
 * - sleeping — глаза-щёлочки, дыхание замедлено до 5.4s, всплывающие «z z» справа-сверху
 * - greeting — подмигивание + наклон 6°. Проигрывается ОДИН цикл при появлении, затем компонент
 *   сам возвращается в idle (внутренний фолбэк по таймеру), если вызывающий код не сменил mood раньше
 * - reading — глаза бегут по «строкам» текста (цикл 2.2s)
 * - waiting — глаза медленно уходят в сторону и обратно (4.6s) + дыхание
 *
 * Масштаб (рекомендация для вызывающего кода — жёстко в рантайме проверяется только порог ≤24px):
 * ≥64px — вся палитра уместна; ~40px — всё кроме celebrate/reading (слишком мелкая деталь);
 * ≤24px — mood принудительно игнорируется компонентом (см. ниже), работает только капля.
 */
export type PrimeMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'ask'
  | 'done'
  | 'celebrate'
  | 'oops'
  | 'sleeping'
  | 'greeting'
  | 'reading'
  | 'waiting';

const FG = '#222224';
const CONFETTI_COLORS = ['#F5D879', '#9FDFAE', '#AFC8EE', '#F0B7AC', '#F5D879', '#9FDFAE'];

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
const EYE_BOTTOM_BASE = 40;  // низ глаза (закрытые глаза при пробуждении)

/**
 * Иерархия перебивания настроений: needs/ask > oops > working > done > fallback (по умолчанию idle).
 * Экспортируется, чтобы вызывающий код не изобретал свой приоритет заново — просто передавай флаги.
 */
export function resolveMood(flags: {
  needs?: boolean;
  ask?: boolean;
  oops?: boolean;
  working?: boolean;
  done?: boolean;
  fallback?: PrimeMood;
}): PrimeMood {
  if (flags.needs || flags.ask) return 'ask';
  if (flags.oops) return 'oops';
  if (flags.working) return 'working';
  if (flags.done) return 'done';
  return flags.fallback ?? 'idle';
}

// Обратная совместимость: старый проп eyes → mood, если mood явно не передан.
// 'down' сознательно даёт только позу oops БЕЗ анимации корпуса — старые вызовы не должны
// внезапно обрасти новым непрерывным движением, которого раньше не было.
function eyesToMood(eyes: PrimeEyes): PrimeMood {
  switch (eyes) {
    case 'idle': return 'idle';
    case 'down': return 'oops';
    case 'away': return 'waiting';
    case 'waking': return 'greeting';
  }
}

interface PrimeMascotProps {
  size?: number;
  /** Легаси-проп геометрии глаз. Если передан mood — mood главнее. */
  eyes?: PrimeEyes;
  decor?: PrimeDecor;
  /**
   * Если true и итоговое настроение — 'greeting' (напрямую или через eyes='waking') —
   * перед приветствием проигрывается пробуждение от закрытых глаз к открытым (1.8s).
   * Только при первом маунте.
   */
  wakeUp?: boolean;
  /** Индикатор-«капля» в правом-верхнем углу: статус агента. Независим от mood. */
  drop?: PrimeDrop;
  /** Настроение маскота — см. PrimeMood. Если не задано, выводится из eyes (обратная совместимость). */
  mood?: PrimeMood;
}

const M = "'Muller', sans-serif";

// Внутренние типы кадров анимации (без импорта типов framer — они не экспортируются стабильно
// из 'motion/react' на верхнем уровне; корректность значений мы контролируем сами).
type EyeAnim = { x: number | number[]; y: number | number[]; height: number | number[]; rx: number | number[]; transition: any };
type BodyAnim = { scale?: number | number[]; rotate?: number | number[]; y?: number | number[]; transition: any };

export default function PrimeMascot({ size = 64, eyes = 'idle', decor = 'none', wakeUp = false, drop = 'none', mood }: PrimeMascotProps) {
  const S = size / 70;
  const CX = CX_BASE * S;
  const CY = CY_BASE * S;
  const R = R_BASE * S;
  const SW = SW_BASE * S;
  const EYE_W = EYE_W_BASE * S;

  const leftCtrl = useAnimationControls();
  const rightCtrl = useAnimationControls();
  const bodyCtrl = useAnimationControls();
  const initialized = useRef(false);
  const greetingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Проверяем prefers-reduced-motion один раз при маунте
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const reducedMotion = reducedMotionRef.current;

  // ≤24px: mood принудительно 'idle' и вообще без анимации (даже без дыхания) — работает только капля.
  const moodLocked = size <= 24;
  // Легаси-путь eyes='down' без явного mood: поза oops, но без «вздоха» корпуса.
  const isLegacyDown = mood === undefined && eyes === 'down';
  const requestedMood: PrimeMood = mood ?? eyesToMood(eyes);
  const activeMood: PrimeMood = moodLocked
    ? 'idle'
    : (reducedMotion && requestedMood === 'greeting' ? 'idle' : requestedMood);
  const noAnimation = reducedMotion || moodLocked;

  // greeting — одноразовый цикл: если mood не сменили извне, сами уходим в idle через таймер.
  const [displayMood, setDisplayMood] = useState<PrimeMood>(activeMood);

  useEffect(() => {
    if (greetingTimeoutRef.current) {
      clearTimeout(greetingTimeoutRef.current);
      greetingTimeoutRef.current = null;
    }
    setDisplayMood(activeMood);
    if (activeMood === 'greeting') {
      const totalMs = (wakeUp ? 1800 : 0) + 3400;
      greetingTimeoutRef.current = setTimeout(() => {
        setDisplayMood(prev => (prev === 'greeting' ? 'idle' : prev));
      }, totalMs);
    }
    return () => {
      if (greetingTimeoutRef.current) clearTimeout(greetingTimeoutRef.current);
    };
  }, [activeMood, wakeUp]);

  // Считаем и проигрываем геометрию текущего настроения
  useEffect(() => {
    const isFirstMount = !initialized.current;
    const staticBody = isLegacyDown;

    const toX = (cx: number, dx = 0) => (cx - EYE_W_BASE / 2 + dx) * S;
    const toPx = (v: number) => v * S;
    const mapArr = (arr: number[]) => arr.map(toPx);
    const mapXArr = (arr: number[], dx = 0) => arr.map(v => toX(v, dx));

    const LX = EYE_LX_BASE, RX = EYE_RX_BASE, TOP = EYE_TOP_BASE, H = EYE_H_BASE;

    const settle = { duration: 0.6, ease: [0.4, 0, 0.2, 1] };
    const reset = { duration: 0.4, ease: [0.4, 0, 0.2, 1] };

    let left: EyeAnim = { x: toX(LX), y: toPx(TOP), height: toPx(H), rx: 0, transition: settle };
    let right: EyeAnim = { x: toX(RX), y: toPx(TOP), height: toPx(H), rx: 0, transition: settle };
    let body: BodyAnim = { scale: 1, rotate: 0, y: 0, transition: reset };

    switch (displayMood) {
      case 'idle': {
        const blinkY = TOP + (H - 1.7) / 2;
        const trans = { duration: 5.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.8, 0.83, 0.86, 0.88, 1] };
        left = { x: toX(LX), y: mapArr([TOP, TOP, TOP, TOP, blinkY, TOP]), height: mapArr([H, H, H, H, 1.7, H]), rx: 0, transition: trans };
        right = { ...left, x: toX(RX) };
        body = { scale: [1, 1.022, 1], transition: { duration: 4.6, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
      case 'listening': {
        const y = toPx(TOP - 0.15 * H);
        left = { x: toX(LX), y, height: toPx(H), rx: 0, transition: settle };
        right = { x: toX(RX), y, height: toPx(H), rx: 0, transition: settle };
        body = { rotate: [-4, 4, -4], transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
      case 'thinking': {
        const times = [0, 0.25, 0.6, 0.8, 1];
        const trans = { duration: 3.4, repeat: Infinity, ease: 'easeInOut', times };
        const y = mapArr([TOP, TOP - 4, TOP - 4, TOP - 2, TOP]);
        left = { x: mapXArr([LX, LX + 3, LX + 3, LX - 2, LX]), y, height: toPx(H), rx: 0, transition: trans };
        right = { x: mapXArr([RX, RX + 3, RX + 3, RX - 2, RX]), y, height: toPx(H), rx: 0, transition: trans };
        body = { scale: 1, rotate: 0, y: 0, transition: reset };
        break;
      }
      case 'working': {
        const h = toPx(20);
        const y = toPx(TOP - (20 - H) / 2);
        const trans = { duration: 1.5, repeat: Infinity, ease: 'easeInOut' };
        left = { x: mapXArr([LX - 3, LX + 3, LX - 3]), y, height: h, rx: 0, transition: trans };
        right = { x: mapXArr([RX - 3, RX + 3, RX - 3]), y, height: h, rx: 0, transition: trans };
        body = { scale: 1, rotate: 0, y: 0, transition: reset };
        break;
      }
      case 'ask': {
        left = {
          x: toX(LX), y: toPx(TOP), height: mapArr([24, 15, 24]), rx: 0,
          transition: { duration: 1.9, repeat: Infinity, ease: 'easeInOut' },
        };
        right = { x: toX(RX), y: toPx(TOP), height: toPx(H), rx: 0, transition: settle };
        body = {
          rotate: [0, -5, 4, 0],
          transition: { duration: 3.5, repeat: Infinity, ease: 'easeInOut', times: [0, 0.05, 0.12, 0.2] },
        };
        break;
      }
      case 'done': {
        const h = toPx(8);
        left = { x: toX(LX), y: toPx(TOP + 4), height: h, rx: h / 2, transition: settle };
        right = { x: toX(RX), y: toPx(TOP + 4), height: h, rx: h / 2, transition: settle };
        body = { y: [0, toPx(-7), 0], transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
      case 'celebrate': {
        const h = toPx(8);
        left = { x: toX(LX), y: toPx(TOP + 4), height: h, rx: h / 2, transition: settle };
        right = { x: toX(RX), y: toPx(TOP + 4), height: h, rx: h / 2, transition: settle };
        body = {
          y: mapArr([0, -9, 0, -5, 0]), rotate: [0, -4, 0, 3, 0],
          transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut', times: [0, 0.35, 0.5, 0.85, 1] },
        };
        break;
      }
      case 'oops': {
        left = { x: toX(LX), y: toPx(TOP + 5), height: toPx(H * 0.7), rx: 0, transition: settle };
        right = { x: toX(RX), y: toPx(TOP + 5), height: toPx(H * 0.7), rx: 0, transition: settle };
        body = staticBody
          ? { scale: 1, rotate: 0, y: 0, transition: reset }
          : { y: [0, toPx(2.5), 0], transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
      case 'sleeping': {
        left = { x: toX(LX), y: toPx(TOP + 2), height: toPx(5), rx: 0, transition: settle };
        right = { x: toX(RX), y: toPx(TOP + 2), height: toPx(5), rx: 0, transition: settle };
        body = { scale: [1, 1.022, 1], transition: { duration: 5.4, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
      case 'greeting': {
        const winkY = TOP + (H - 1.7) / 2;
        const winkTimes = [0, 0.06, 0.08, 0.1, 1];
        left = { x: toX(LX), y: toPx(TOP), height: toPx(H), rx: 0, transition: settle };
        right = {
          x: toX(RX), y: mapArr([TOP, TOP, winkY, TOP, TOP]), height: mapArr([H, H, 1.7, H, H]), rx: 0,
          transition: { duration: 3.4, ease: 'easeInOut', times: winkTimes },
        };
        body = { rotate: [0, 6, 0], transition: { duration: 3.4, ease: 'easeInOut', times: [0, 0.5, 1] } };
        break;
      }
      case 'reading': {
        const times = [0, 0.25, 0.5, 0.75, 1];
        const trans = { duration: 2.2, repeat: Infinity, ease: 'easeInOut', times };
        const y = mapArr([TOP - 3, TOP - 3, TOP, TOP, TOP - 3]);
        left = { x: mapXArr([LX - 3, LX + 3, LX - 3, LX + 3, LX - 3]), y, height: toPx(18), rx: 0, transition: trans };
        right = { x: mapXArr([RX - 3, RX + 3, RX - 3, RX + 3, RX - 3]), y, height: toPx(18), rx: 0, transition: trans };
        body = { scale: 1, rotate: 0, y: 0, transition: reset };
        break;
      }
      case 'waiting': {
        const times = [0, 0.7, 0.78, 0.85, 1];
        const trans = { duration: 4.6, repeat: Infinity, ease: 'easeInOut', times };
        left = { x: mapXArr([LX, LX, LX + 5, LX + 5, LX]), y: toPx(TOP), height: toPx(H), rx: 0, transition: trans };
        right = { x: mapXArr([RX, RX, RX + 5, RX + 5, RX]), y: toPx(TOP), height: toPx(H), rx: 0, transition: trans };
        body = { scale: [1, 1.022, 1], transition: { duration: 4.6, repeat: Infinity, ease: 'easeInOut' } };
        break;
      }
    }

    const firstFrame = (v: number | number[] | undefined, fallback = 0) =>
      v === undefined ? fallback : (Array.isArray(v) ? v[0] : v);
    const staticLeft = { x: firstFrame(left.x), y: firstFrame(left.y), height: firstFrame(left.height), rx: firstFrame(left.rx) };
    const staticRight = { x: firstFrame(right.x), y: firstFrame(right.y), height: firstFrame(right.height), rx: firstFrame(right.rx) };
    const staticBodyPose = { scale: firstFrame(body.scale, 1), rotate: firstFrame(body.rotate, 0), y: firstFrame(body.y, 0) };

    if (noAnimation) {
      // Reduced motion или size ≤ 24: только статичная поза, никаких циклов.
      leftCtrl.set(staticLeft);
      rightCtrl.set(staticRight);
      bodyCtrl.set(staticBodyPose);
      initialized.current = true;
      return;
    }

    if (isFirstMount && wakeUp && displayMood === 'greeting') {
      // Пробуждение от закрытых глаз (1.8s), затем один цикл приветствия (подмигивание + наклон).
      const leftHomeX = toX(LX), rightHomeX = toX(RX);
      leftCtrl.set({ x: leftHomeX, y: toPx(EYE_BOTTOM_BASE), height: 0, rx: 0 });
      rightCtrl.set({ x: rightHomeX, y: toPx(EYE_BOTTOM_BASE), height: 0, rx: 0 });
      bodyCtrl.set({ scale: 1, rotate: 0, y: 0 });
      const openTransition: any = { duration: 1.8, ease: [0.215, 0.61, 0.355, 1] };
      Promise.all([
        leftCtrl.start({ x: leftHomeX, y: toPx(TOP), height: toPx(H), rx: 0, transition: openTransition }),
        rightCtrl.start({ x: rightHomeX, y: toPx(TOP), height: toPx(H), rx: 0, transition: openTransition }),
      ]).then(() => {
        leftCtrl.start(left);
        rightCtrl.start(right);
        bodyCtrl.start(body);
      });
    } else {
      if (isFirstMount) {
        leftCtrl.set(staticLeft);
        rightCtrl.set(staticRight);
        bodyCtrl.set(staticBodyPose);
      }
      leftCtrl.start(left);
      rightCtrl.start(right);
      bodyCtrl.start(body);
    }

    initialized.current = true;
  }, [displayMood, S, wakeUp, noAnimation, isLegacyDown, leftCtrl, rightCtrl, bodyCtrl]);

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <motion.div animate={bodyCtrl} style={{ width: size, height: size, transformOrigin: '50% 50%' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx={CX} cy={CY} r={R} stroke={FG} strokeWidth={SW} fill="none" />
          <motion.rect fill={FG} width={EYE_W} animate={leftCtrl} />
          <motion.rect fill={FG} width={EYE_W} animate={rightCtrl} />
        </svg>
      </motion.div>

      {/* listening: расходящееся кольцо-«сонар» вовне */}
      {!noAnimation && displayMood === 'listening' && (
        <motion.div
          style={{
            position: 'absolute', top: 0, left: 0, width: size, height: size,
            borderRadius: '50%', border: `2px solid ${FG}`, boxSizing: 'border-box', pointerEvents: 'none',
          }}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.45, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      {/* sleeping: всплывающие "z z" справа-сверху */}
      {!noAnimation && displayMood === 'sleeping' && (
        <div style={{ position: 'absolute', top: -size * 0.22, right: -size * 0.18, pointerEvents: 'none' }}>
          <motion.span
            style={{ position: 'absolute', fontFamily: M, fontWeight: 600, fontSize: size * 0.22, color: FG }}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], y: [0, -size * 0.25] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          >z</motion.span>
          <motion.span
            style={{ position: 'absolute', left: size * 0.16, top: size * 0.1, fontFamily: M, fontWeight: 600, fontSize: size * 0.15, color: FG }}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: [0, 1, 0], y: [0, -size * 0.2] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 1.4 }}
          >z</motion.span>
        </div>
      )}

      {/* celebrate: конфетти, разлетающееся по кругу (использовать ≤1 раза в день — на совести вызывающего кода) */}
      {!noAnimation && displayMood === 'celebrate' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
          {CONFETTI_COLORS.map((color, i) => {
            const angle = (Math.PI * 2 * i) / CONFETTI_COLORS.length;
            const dist = size * 0.7;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            return (
              <motion.div
                key={i}
                style={{ position: 'absolute', width: size * 0.09, height: size * 0.09, borderRadius: '50%', background: color }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{ x: [0, dx], y: [0, dy], opacity: [1, 0], scale: [1, 0.6] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut', delay: (i * 2.4) / CONFETTI_COLORS.length }}
              />
            );
          })}
        </div>
      )}

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
