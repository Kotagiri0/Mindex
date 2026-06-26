import { useEffect, useRef, useState, useCallback } from 'react';
import { loginYandexUser } from './auth';
import { LocalUser } from '../types';

/**
 * Вход через Яндекс (OAuth code-flow).
 *
 * Открываем попап на oauth.yandex.ru/authorize?response_type=code, маленькая страница
 * /auth/yandex/callback.html ловит code+state и шлёт их обратно через postMessage.
 * Код уходит на бэкенд (/api/auth/yandex), где меняется на токен (client_secret на сервере).
 *
 * Безопасность:
 *  - `state` (nonce) против login-CSRF / подмены кода: генерим перед стартом, проверяем при ответе;
 *  - слушаем postMessage только со своего origin;
 *  - фолбэк через localStorage, если попап заблокирован (полный редирект).
 */

interface UseYandexLoginResult {
  startLogin: () => void;
  loading: boolean;
  error: string;
  ready: boolean;
}

const REDIRECT_PATH = '/auth/yandex/callback.html';
const STATE_KEY = 'yandex_oauth_state';
const RESULT_KEY = 'yandex_auth_result';

function newState(): string {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useYandexLogin(onSuccess: (user: LocalUser) => void): UseYandexLoginResult {
  const [clientId, setClientId] = useState<string>(import.meta.env?.VITE_YANDEX_CLIENT_ID || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    if (clientId) return;
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d?.yandexClientId) setClientId(d.yandexClientId);
    }).catch(() => {});
  }, [clientId]);

  const redirectUri = window.location.origin + REDIRECT_PATH;

  // Проверяем state и обмениваем код на сессию
  const handleResult = useCallback((data: any) => {
    if (!data || data.source !== 'yandex-auth') return;
    const expected = (() => { try { return localStorage.getItem(STATE_KEY); } catch { return null; } })();
    try { localStorage.removeItem(STATE_KEY); } catch { /* ignore */ }

    if (data.error) { setError(String(data.error)); setLoading(false); return; }
    // CSRF-защита: state из ответа должен совпасть с тем, что мы сохранили перед стартом
    if (!expected || data.state !== expected) {
      setError('Сессия входа не совпала. Попробуй ещё раз.');
      setLoading(false);
      return;
    }
    if (!data.code) { setError('Яндекс не вернул код авторизации.'); setLoading(false); return; }

    setLoading(true);
    loginYandexUser(String(data.code), redirectUri)
      .then((user) => onSuccessRef.current(user))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось войти через Яндекс.'))
      .finally(() => setLoading(false));
  }, [redirectUri]);

  // Сообщение от callback-попапа
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return; // только свой origin
      if (!ev.data || ev.data.source !== 'yandex-auth') return;
      try { popupRef.current?.close(); } catch { /* ignore */ }
      handleResult(ev.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleResult]);

  // Фолбэк: попап был заблокирован → callback положил результат в localStorage и редиректнул сюда
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(RESULT_KEY); } catch { /* ignore */ }
    if (!raw) return;
    try { localStorage.removeItem(RESULT_KEY); } catch { /* ignore */ }
    try { handleResult(JSON.parse(raw)); } catch { /* ignore */ }
  }, [handleResult]);

  const startLogin = useCallback(() => {
    if (!clientId) { setError('Вход через Яндекс не настроен.'); return; }
    setError('');
    setLoading(true);

    const state = newState();
    try { localStorage.setItem(STATE_KEY, state); } catch { /* ignore */ }

    const url = 'https://oauth.yandex.ru/authorize'
      + '?response_type=code'
      + '&client_id=' + encodeURIComponent(clientId)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&state=' + encodeURIComponent(state)
      + '&force_confirm=yes';

    const w = 520, h = 600;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    popupRef.current = window.open(url, 'yandex-oauth', `width=${w},height=${h},left=${left},top=${top}`);

    if (!popupRef.current) {
      // Попап заблокирован — уходим редиректом в том же окне (callback вернёт через localStorage)
      window.location.href = url;
    }
  }, [clientId, redirectUri]);

  return { startLogin, loading, error, ready: Boolean(clientId) };
}
