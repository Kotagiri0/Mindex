import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Copy, Check } from 'lucide-react';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { apiFetch } from '../lib/auth';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

const AI_PROMPT = `Опиши меня в свободной форме: чем занимаюсь, какие проекты веду, главные цели сейчас, что меня беспокоит, как я принимаю решения. 150-200 слов, без списков, как будто рассказываешь о человеке другу.`;

const MIN_ROWS_HEIGHT = 80;
const MAX_HEIGHT = 220;

interface OnboardingProps {
  onComplete: (threadId?: string) => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [text, setText] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiReply, setAiReply] = useState('');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, [text]);

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content || loading) return;

    setLoading(true);
    try {
      const threadId = uuid();
      const now = Date.now();
      const timeStr = new Date().toTimeString().slice(0, 5);

      // Call AI for a real response
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

      setAiReply(assistantText);

      const messages: Array<{ role: 'user' | 'assistant'; content: string; time: string }> = [
        { role: 'user', content, time: timeStr },
      ];
      if (assistantText) {
        messages.push({ role: 'assistant', content: assistantText, time: new Date().toTimeString().slice(0, 5) });
      }

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

      // If we got a reply, show it briefly before completing
      if (assistantText) {
        await new Promise(r => setTimeout(r, 2800));
      }

      onComplete(threadId);
    } catch (e) {
      console.error('[onboarding]', e);
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(AI_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  };

  const MysliLogo = ({ size = 34, strokeWidth = 11 }: { size?: number; strokeWidth?: number }) => (
    <svg width={size} height={size} viewBox="0 0 156 156" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="152" height="152" rx="76" stroke="white" strokeWidth={strokeWidth}/>
      <path d="M126 78H30" stroke="white" strokeWidth={strokeWidth}/>
      <path d="M101 55L55 101" stroke="white" strokeWidth={strokeWidth}/>
      <path d="M101 101L55 55" stroke="white" strokeWidth={strokeWidth}/>
      <path d="M78 126V30" stroke="white" strokeWidth={strokeWidth}/>
    </svg>
  );

  // Path C — skip view (unchanged)
  if (skipped) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0', alignItems: 'center', justifyContent: 'center', padding: '0 28px' }}>
        <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ background: '#ffffff', borderRadius: 20, padding: '20px 20px 16px', width: '100%', maxWidth: 400 }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#0B0D10', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MysliLogo size={18} strokeWidth={14} />
            </div>
            <div style={{ fontFamily: M, fontSize: 15, color: '#222224', lineHeight: 1.65 }}>
              Я Мысль — помогаю с задачами, заметками и планами. Всё что ты обсуждаешь со мной — сохраняется и помогает мне понимать тебя лучше со временем. Можешь добавлять задачи голосом, выгружать хаос из головы или просто думать вслух.
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => onComplete()}
            style={{ width: '100%', padding: '13px 0', background: '#0B0D10', color: '#ffffff', border: 'none', borderRadius: 13, fontFamily: M, fontSize: 15, fontWeight: 500, cursor: 'pointer' }}
          >
            Продолжить
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // Path A / B — main view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      <div style={{ flex: '0 0 16%' }} />

      {/* Logo */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          style={{ width: 64, height: 64, borderRadius: '50%', background: '#0B0D10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <MysliLogo size={34} strokeWidth={11} />
        </motion.div>
      </div>

      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ textAlign: 'center', padding: '0 28px', marginBottom: 8 }}
      >
        <div style={{ fontFamily: F, fontSize: 26, color: '#222224', lineHeight: 1.15, marginBottom: 10 }}>
          Привет, я Мысль
        </div>
        <div style={{ fontFamily: M, fontSize: 15, color: 'rgba(34,34,36,0.55)', lineHeight: 1.6 }}>
          Помогаю думать, планировать и не забывать важное. Чем больше ты расскажешь о себе — тем точнее буду помогать.
        </div>
      </motion.div>

      <div style={{ flex: 1 }} />

      {/* AI reply bubble */}
      <AnimatePresence>
        {aiReply && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ padding: '0 20px 16px' }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#0B0D10', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MysliLogo size={16} strokeWidth={14} />
              </div>
              <div style={{ background: '#ffffff', borderRadius: '4px 16px 16px 16px', padding: '10px 14px', fontFamily: M, fontSize: 14, color: '#222224', lineHeight: 1.6, maxWidth: 'calc(100% - 42px)' }}>
                {aiReply}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom card */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18 }}
        style={{ background: '#ffffff', borderRadius: '20px 20px 0 0', padding: '18px 20px 0' }}
      >
        {/* AI prompt block */}
        <AnimatePresence>
          {showAiPrompt && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ background: '#f5f5f5', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ fontFamily: M, fontSize: 13, color: '#444', lineHeight: 1.55, marginBottom: 10 }}>
                  {AI_PROMPT}
                </div>
                <button
                  onClick={handleCopy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid rgba(34,34,36,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: M, fontSize: 13, color: '#444' }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
              <div style={{ fontFamily: M, fontSize: 12, color: 'rgba(34,34,36,0.4)', marginBottom: 10 }}>
                Вставь в нейронку, которой пользуешься, и пришли сюда результат
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-resizing textarea */}
        <textarea
          ref={textareaRef}
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
          placeholder="Чем занимаешься, какие цели сейчас, что беспокоит..."
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowAiPrompt(v => !v)}
              style={{
                background: showAiPrompt ? '#0B0D10' : 'rgba(34,34,36,0.08)',
                border: 'none', cursor: 'pointer',
                fontFamily: M, fontSize: 13, fontWeight: 500,
                color: showAiPrompt ? '#fff' : '#222224',
                padding: '8px 16px', borderRadius: 40,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              Импорт контекста
            </motion.button>
            <button
              onClick={() => setSkipped(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: M, fontSize: 13, color: 'rgba(34,34,36,0.35)', padding: '8px 4px' }}
            >
              Пропустить
            </button>
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
                  width: 40, height: 40, borderRadius: '50%', background: '#0B0D10',
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
                style={{ width: 40, height: 40, borderRadius: '50%', background: '#0B0D10', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div style={{ height: 'max(20px, env(safe-area-inset-bottom, 20px))' }} />
      </motion.div>
    </div>
  );
}
