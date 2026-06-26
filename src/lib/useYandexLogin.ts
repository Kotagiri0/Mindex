import { useEffect, useRef, useState, useCallback } from 'react';
import { loginYandexUser } from './auth';
import { LocalUser } from '../types';

/**
 * Вход через Яндекс (OAuth code-flow).
 *
 * Открываем попап на oauth.yandex.ru/authorize?response_type=code, маленькая страница
 * /auth/yandex/callback.html ловит code и шлёт его обратно через postMessage.
 * Код уходит на бэкенд (/api/auth/yandex), где меняется на токен (client_secret на сервере).
 *
 * Аналог useGoogleLogin — единый колбэк на успех, тот же интерфейс.
 */

interface UseYandexLoginResult {
  startLogin: () => void;
  loading: boolean;
  error: string;
  ready: boolean;
}

const REDIRECT_PATH = '/auth/yandex/callback.html';

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

  const exchange = useCallback(async (code: string, redirectUri: string) => {
    try {
      const user = await loginYandexUser(code, redirectUri);
      onSuccessRef.current(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти через Яндекс.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Сообщение от callback-попапа
  useEffect(() => {
    const redirectUri = window.location.origin + REDIRECT_PATH;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || d.source !== 'yandex-auth') return;
      try { popupRef.current?.close(); } catch { /* ignore */ }
      if (d.error) { setError(String(d.error)); setLoading(false); return; }
      if (d.code) exchange(String(d.code), redirectUri);
      else { setError('Яндекс не вернул код авторизации.'); setLoading(false); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [exchange]);

  const startLogin = useCallback(() => {
    if (!clientId) { setError('Вход через Яндекс не настроен.'); return; }
    setError('');
    setLoading(true);

    const redirectUri = window.location.origin + REDIRECT_PATH;
    const url = 'https://oauth.yandex.ru/authorize'
      + '?response_type=code'
      + '&client_id=' + encodeURIComponent(clientId)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&force_confirm=yes';

    const w = 520, h = 600;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    popupRef.current = window.open(url, 'yandex-oauth', `width=${w},height=${h},left=${left},top=${top}`);

    if (!popupRef.current) {
      // Попап заблокирован — уходим редиректом в том же окне (callback вернёт через localStorage)
      window.location.href = url;
    }
  }, [clientId]);

  return { startLogin, loading, error, ready: Boolean(clientId) };
}
