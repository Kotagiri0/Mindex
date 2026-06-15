import { useEffect, useRef, useState, useCallback } from 'react';
import { loginGoogleUser } from './auth';
import { LocalUser } from '../types';

/**
 * Переиспользуемый Google Sign-In: ленивая загрузка GIS-скрипта, скрытый button-рендер
 * (единственный способ запустить OAuth без FedCM-предупреждений), один колбэк на успех.
 *
 * Извлечено из LocalAuth, чтобы публичная страница события (#/e/:id) использовала тот же
 * холодный гейт без дублирования логики.
 */

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

const loadGoogleIdentityScript = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Google Sign-In недоступен. Попробуй ещё раз.')), 5000);

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-gsi="true"]');
    if (existingScript) {
      if (window.google?.accounts?.id) { clearTimeout(timeout); resolve(); return; }
      existingScript.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      existingScript.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Не удалось загрузить Google Sign-In.')); }, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Не удалось загрузить Google Sign-In.')); };
    document.head.appendChild(script);
  }).catch((error) => { googleScriptPromise = null; throw error; });

  return googleScriptPromise;
};

interface UseGoogleLoginResult {
  /** Контейнер для скрытого Google-iframe. Обязательно отрендерить в DOM (вне display:none). */
  buttonRef: React.RefObject<HTMLDivElement | null>;
  /** Запустить OAuth-поток. */
  startLogin: () => Promise<void>;
  loading: boolean;
  error: string;
  /** Готов ли вход (есть client_id). Если false — кнопку лучше скрыть/задизейблить. */
  ready: boolean;
}

export function useGoogleLogin(onSuccess: (user: LocalUser) => void): UseGoogleLoginResult {
  const [googleClientId, setGoogleClientId] = useState<string>(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (googleClientId) return;
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d?.googleClientId) setGoogleClientId(d.googleClientId);
    }).catch(() => {});
  }, [googleClientId]);

  const startLogin = useCallback(async () => {
    if (!googleClientId) { setError('Google вход не настроен.'); return; }
    setError('');
    setLoading(true);
    try {
      await loadGoogleIdentityScript();
      if (!window.google?.accounts?.id) throw new Error('Google Sign-In недоступен.');
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          if (!credential) { setError('Google не вернул токен авторизации.'); setLoading(false); return; }
          try {
            const user = await loginGoogleUser(credential);
            onSuccessRef.current(user);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось войти через Google.');
            setLoading(false);
          }
        },
      });
      if (buttonRef.current) {
        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black', size: 'large', shape: 'pill', width: 320,
        });
        setTimeout(() => {
          const btn = buttonRef.current?.querySelector('div[role="button"]') as HTMLElement | null;
          btn?.click();
          setLoading(false);
        }, 50);
      } else {
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google Sign-In недоступен.');
      setLoading(false);
    }
  }, [googleClientId]);

  return { buttonRef, startLogin, loading, error, ready: Boolean(googleClientId) };
}
