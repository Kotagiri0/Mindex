import { useState, useRef, useCallback, useEffect } from 'react';

const CHAR_INTERVAL_MS = 16; // ~60 chars/sec — smooth like Google AI

export function useTypewriter() {
  const [display, setDisplay] = useState<string | null>(null);
  const queueRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const flush = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      if (!queueRef.current.length) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        return;
      }
      // drain 1-3 chars per tick for natural rhythm
      const n = Math.min(queueRef.current.length > 20 ? 3 : 1, queueRef.current.length);
      const chars = queueRef.current.slice(0, n);
      queueRef.current = queueRef.current.slice(n);
      setDisplay(prev => (prev ?? '') + chars);
    }, CHAR_INTERVAL_MS);
  }, []);

  const push = useCallback((chunk: string) => {
    if (!activeRef.current) {
      activeRef.current = true;
      setDisplay('');
    }
    queueRef.current += chunk;
    flush();
  }, [flush]);

  const reset = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    queueRef.current = '';
    activeRef.current = false;
    setDisplay(null);
  }, []);

  // drain remaining queue on unmount
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return { display, push, reset };
}
