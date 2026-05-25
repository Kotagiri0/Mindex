import { useEffect, useState, useCallback } from 'react';

/**
 * Простой хеш-роутер: читает window.location.hash, возвращает текущий маршрут и навигатор.
 * Маршруты вида '#/login', '#/signup'. При отсутствии хеша возвращает defaultRoute.
 *
 * Используется только для экранов авторизации — внутри SPA после логина роутинг не нужен.
 */
export function useHashRoute(defaultRoute: string): [string, (next: string) => void] {
  const read = useCallback(() => {
    const h = window.location.hash.replace(/^#/, '');
    return h || defaultRoute;
  }, [defaultRoute]);

  const [route, setRoute] = useState<string>(() => read());

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [read]);

  const navigate = useCallback((next: string) => {
    const normalized = next.startsWith('#') ? next : `#${next}`;
    if (window.location.hash !== normalized) {
      window.location.hash = normalized;
    } else {
      setRoute(read());
    }
  }, [read]);

  return [route, navigate];
}
