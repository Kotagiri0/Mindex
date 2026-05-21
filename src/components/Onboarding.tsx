import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { apiFetch } from '../lib/auth';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";
const FG = '#0B0D10';
const BG = '#f0f0f0';

const MAX_HEIGHT = 220;
const MIN_ROWS_HEIGHT = 80;

interface OnboardingProps {
  onComplete: (threadId?: string) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [stage, setStage] = useState<'plus' | 'animating' | 'input'>('plus');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content || loading) return;
    setLoading(true);
    try {
      const threadId = uuid();
      const now = Date.now();
      const timeStr = new Date().toTimeString().slice(0, 5);

      let assistantText = '';
      try {
        const aiRes = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content }] }),
        });
        if (aiRes.ok) {
          const data = await aiRes.json();
          assistantText = data?.choices?.[0]?.message?.content?.trim() ?? '';
        }
      } catch {}

      const messages: Array<{ role: 'user' | 'assistant'; content: string; time: string }> = [
        { role: 'user', content, time: timeStr },
        ...(assistantText ? [{ role: 'assistant' as const, content: assistantText, time: new Date().toTimeString().slice(0, 5) }] : []),
      ];

      const thread = {
        id: threadId,
        title: 'О себе',
        preview: content.slice(0, 100),
        messages,
        createdAt: now,
        source: 'заметка' as const,
        is_meaningful: true,
        summary: content,
      };

      await db.saveThread(thread);
      apiFetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: thread.messages, threadId, raw: true, rawSummary: content }),
      }).catch(() => {});

      onComplete(threadId);
    } catch {
      onComplete();
    } finally {
      setLoading(false);
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
            style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 0 0' }}
          >
            {/* Heading */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px' }}>
              <div style={{ fontFamily: F, fontSize: 26, color: '#222224', lineHeight: 1.2, textAlign: 'center' }}>
                что у тебя сейчас в голове?
              </div>
            </div>

            {/* Bottom card with input */}
            <div style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '18px 20px 0' }}>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                }}
                placeholder="напиши первую мысль..."
                style={{
                  width: '100%', border: 'none', outline: 'none', background: 'transparent',
                  fontFamily: M, fontSize: 15, color: '#222224', lineHeight: 1.65,
                  resize: 'none', display: 'block', boxSizing: 'border-box',
                  minHeight: MIN_ROWS_HEIGHT, maxHeight: MAX_HEIGHT, overflowY: 'auto',
                  transition: 'height 0.1s ease',
                }}
              />

              {/* Actions row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 4px' }}>
                <div style={{ fontFamily: M, fontSize: 12, color: 'rgba(34,34,36,0.35)', lineHeight: 1.4 }}>
                  мысль сохранится и мысль её запомнит
                </div>

                <AnimatePresence>
                  {text.trim() && !loading && (
                    <motion.button
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={handleSubmit}
                      style={{
                        width: 40, height: 40, borderRadius: '50%', background: FG,
                        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <ArrowUp size={17} color="#fff" strokeWidth={2} />
                    </motion.button>
                  )}
                  {loading && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      style={{ width: 40, height: 40, borderRadius: '50%', background: FG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                      <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div style={{ height: 'max(20px, env(safe-area-inset-bottom, 20px))' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
