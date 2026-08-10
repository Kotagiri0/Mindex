import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Loader } from 'lucide-react';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { useVoiceInput, isMobileDevice } from '../lib/useVoiceInput';

const M = "'Mulish', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";
const FG = '#0B0D10';
const BG = '#f0f0f0';

const MAX_HEIGHT = 220;
const MIN_ROWS_HEIGHT = 80;

interface OnboardingProps {
  onComplete: (threadId?: string, initialMsg?: string) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [stage, setStage] = useState<'plus' | 'animating' | 'input'>('plus');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = isMobileDevice();
  const { state: voiceState, startRecording, stopRecording, toggleRecording } = useVoiceInput(
    (transcribed) => setText(prev => prev + (prev ? ' ' : '') + transcribed)
  );

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, [text]);

  // Auto-focus on stage 2
  useEffect(() => {
    if (stage === 'input') {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [stage]);

  const handleTap = () => {
    if (stage !== 'plus') return;
    setStage('animating');
    // After 1.5s total (grow 0.9s + hold + fadeout 0.3s) → show input
    setTimeout(() => setStage('input'), 1500);
  };

  const createThread = async (title: string) => {
    const threadId = uuid();
    const thread = { id: threadId, title, preview: '', messages: [], createdAt: Date.now() };
    await db.saveThread(thread);
    return threadId;
  };

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content || loading) return;
    setLoading(true);
    try {
      const threadId = await createThread(content.length > 40 ? content.slice(0, 40) + '…' : content);
      onComplete(threadId, content);
    } catch {
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    try {
      const threadId = await createThread('Знакомство');
      onComplete(threadId, '__onboarding_skip__');
    } catch {
      onComplete();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: BG }}>
      <style>{`
        @keyframes ob-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-7px); }
        }
        @keyframes ob-grow-fade {
          0%   { transform: scale(1);   opacity: 1; }
          60%  { transform: scale(2.2); opacity: 1; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>

      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      <AnimatePresence mode="wait">
        {/* ── Stage 1: Plus animation ── */}
        {(stage === 'plus' || stage === 'animating') && (
          <motion.div
            key="plus"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}
          >
            {/* Logo wrapper — float or grow+fade */}
            <div
              onClick={handleTap}
              style={{
                cursor: stage === 'plus' ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: stage === 'plus'
                  ? 'ob-float 3s ease-in-out infinite'
                  : 'ob-grow-fade 1.5s cubic-bezier(0.34, 1.2, 0.64, 1) forwards',
              }}
            >
              <svg
                width="48" height="48"
                viewBox="0 0 1681 1681"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Circle — fades in on tap */}
                <rect
                  x="58.8315" y="58.8315"
                  width="1563.24" height="1563.24"
                  rx="781.619"
                  stroke={FG} strokeWidth="117.663"
                  style={{
                    opacity: stage === 'animating' ? 1 : 0,
                    transition: stage === 'animating' ? 'opacity 0.65s ease 0.2s' : 'none',
                  }}
                />
                {/* Horizontal */}
                <path d="M1344.73 840.43H336.186" stroke={FG} strokeWidth="117.663" />
                {/* Diagonal 1 — fades in on tap */}
                <path
                  d="M1078.16 602.734L602.734 1078.16"
                  stroke={FG} strokeWidth="117.663"
                  style={{
                    opacity: stage === 'animating' ? 1 : 0,
                    transition: stage === 'animating' ? 'opacity 0.6s ease 0.12s' : 'none',
                  }}
                />
                {/* Diagonal 2 — fades in on tap */}
                <path
                  d="M1078.16 1078.16L602.734 602.734"
                  stroke={FG} strokeWidth="117.663"
                  style={{
                    opacity: stage === 'animating' ? 1 : 0,
                    transition: stage === 'animating' ? 'opacity 0.6s ease 0.3s' : 'none',
                  }}
                />
                {/* Vertical */}
                <path d="M840.469 1344.71L840.469 336.167" stroke={FG} strokeWidth="117.663" />
              </svg>
            </div>

            {/* Hint */}
            <div
              style={{
                fontFamily: M,
                fontSize: 13,
                color: 'rgba(11,13,16,0.3)',
                opacity: stage === 'animating' ? 0 : 1,
                transition: 'opacity 0.2s ease',
              }}
            >
              нажми, чтобы начать
            </div>
          </motion.div>
        )}

        {/* ── Stage 2: Input ── */}
        {stage === 'input' && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          >
            {/* CTA block */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 28px' }}>
              {/* Мысль logo */}
              <svg width="48" height="48" viewBox="0 0 1681 1681" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="58.8315" y="58.8315" width="1563.24" height="1563.24" rx="781.619" stroke={FG} strokeWidth="117.663" />
                <path d="M1344.73 840.43H336.186" stroke={FG} strokeWidth="117.663" />
                <path d="M1078.16 602.734L602.734 1078.16" stroke={FG} strokeWidth="117.663" />
                <path d="M1078.16 1078.16L602.734 602.734" stroke={FG} strokeWidth="117.663" />
                <path d="M840.469 1344.71L840.469 336.167" stroke={FG} strokeWidth="117.663" />
              </svg>
              <div style={{ fontFamily: F, fontSize: 26, color: '#222224', lineHeight: 1.2, textAlign: 'center', whiteSpace: 'pre-line' }}>
                {'Какие планы\nна сегодня?'}
              </div>
              <div style={{ fontFamily: M, fontSize: 15, color: 'rgba(34,34,36,0.55)', lineHeight: 1.55, textAlign: 'center' }}>
                Я помогу не забыть
              </div>
            </div>

            {/* Input card — same as chat */}
            <div style={{ padding: '0 16px', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
              <div style={{ background: '#ffffff', borderRadius: 20, padding: 16 }}>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !(window.matchMedia('(hover: none)').matches)) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  rows={1}
                  placeholder="Начни первую мысль..."
                  style={{
                    width: '100%', border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: M, fontSize: 15, color: '#222224', lineHeight: 1.55,
                    resize: 'none', display: 'block', boxSizing: 'border-box',
                    maxHeight: MAX_HEIGHT, overflowY: 'auto',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
                  {/* Microphone — functional, same as chat */}
                  <motion.button
                    title={isMobile ? 'Удерживай для записи' : 'Нажми для записи, ещё раз — стоп'}
                    {...(isMobile
                      ? { onPointerDown: startRecording, onPointerUp: stopRecording, onPointerCancel: stopRecording }
                      : { onClick: toggleRecording }
                    )}
                    disabled={voiceState === 'processing'}
                    style={{
                      width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: voiceState === 'recording' ? '#c0392b' : voiceState === 'processing' ? 'rgba(34,34,36,0.15)' : 'rgba(34,34,36,0.08)',
                      transition: 'background 0.15s',
                    }}
                  >
                    {voiceState === 'processing'
                      ? <Loader size={15} strokeWidth={2} color="#222224" className="animate-spin" />
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={voiceState === 'recording' ? '#fff' : 'rgba(34,34,36,0.5)'} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10c0 3.9 2.7 7 7 7s7-3.1 7-7"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                    }
                  </motion.button>

                  {/* Send / loader */}
                  <AnimatePresence>
                    {text.trim() && !loading && (
                      <motion.button
                        key="send"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={handleSubmit}
                        style={{
                          width: 36, height: 36, borderRadius: '50%', background: FG,
                          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}
                      >
                        <ArrowUp size={17} color="#fff" strokeWidth={2} />
                      </motion.button>
                    )}
                    {loading && (
                      <motion.div
                        key="loader"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        style={{ width: 36, height: 36, borderRadius: '50%', background: FG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >
                        <div style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Skip button */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                <button
                  onClick={handleSkip}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: M, fontSize: 14, color: 'rgba(34,34,36,0.4)',
                    padding: '8px 16px',
                  }}
                >
                  Пропустить
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
