import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { Thread } from '../types';
import { db } from '../lib/db';
import { uuid } from '../lib/utils';
import { getCurrentUser } from '../lib/auth';

const M = "'Muller', 'Helvetica Neue', Helvetica, sans-serif";
const F = "'Random Grotesque', sans-serif";

interface NoteEditorProps {
  thread?: Thread;
  onSaved: (thread: Thread) => void;
  onClose: () => void;
}

export default function NoteEditor({ thread, onSaved, onClose }: NoteEditorProps) {
  const [title, setTitle] = useState(thread?.title === 'Новая мысль' ? '' : (thread?.title || ''));
  const [content, setContent] = useState(
    thread?.messages?.[0]?.content || thread?.summary || ''
  );
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  const canSave = content.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const userId = getCurrentUser()?.id;
      const threadId = thread?.id || uuid();
      const now = thread?.createdAt || Date.now();
      const timeStr = new Date().toTimeString().slice(0, 5);
      const resolvedTitle = title.trim() || content.trim().slice(0, 40);

      const saved: Thread = {
        id: threadId,
        title: resolvedTitle || 'Заметка',
        preview: content.trim().slice(0, 100),
        messages: [],
        createdAt: now,
        source: 'заметка' as const,
        is_meaningful: true,
        summary: content.trim(),
      };

      await db.saveThread(saved);

      if (userId) {
        fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: content.trim() }], threadId, userId, raw: true, rawSummary: content.trim() }),
        }).catch(() => {});
      }

      onSaved(saved);
    } catch (e) {
      console.error('[NoteEditor]', e);
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff' }}>
      <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', flexShrink: 0 }}>
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={onClose}
          style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <ChevronLeft size={22} strokeWidth={1.75} color="#222224" />
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleSave}
          disabled={!canSave || saving}
          style={{
            padding: '8px 20px',
            background: canSave ? '#0B0D10' : 'rgba(34,34,36,0.08)',
            color: canSave ? '#fff' : 'rgba(34,34,36,0.3)',
            border: 'none', borderRadius: 999,
            fontFamily: M, fontSize: 14, fontWeight: 500,
            cursor: canSave ? 'pointer' : 'default',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </motion.button>
      </div>

      {/* Title */}
      <div style={{ padding: '4px 24px 0' }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && contentRef.current?.focus()}
          placeholder="Заголовок"
          style={{
            width: '100%', border: 'none', outline: 'none', background: 'transparent',
            fontFamily: F, fontSize: 24, color: '#222224',
            display: 'block', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '10px 24px 0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <textarea
          ref={contentRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
          }}
          placeholder="Напиши что угодно..."
          style={{
            flex: 1, width: '100%', border: 'none', outline: 'none', background: 'transparent',
            fontFamily: M, fontSize: 15, color: '#222224', lineHeight: 1.7,
            resize: 'none', display: 'block', boxSizing: 'border-box', minHeight: 200,
          }}
        />
      </div>

      <div style={{ height: 'env(safe-area-inset-bottom, 0px)', flexShrink: 0 }} />
    </div>
  );
}
