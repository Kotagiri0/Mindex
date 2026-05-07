import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './lib/theme';
import './index.css';

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

if (isStandalone && document.fullscreenEnabled) {
  const cleanupFullscreenListeners = () => {
    window.removeEventListener('pointerdown', requestFullscreen);
    window.removeEventListener('keydown', requestFullscreen);
  };

  const requestFullscreen = () => {
    if (document.fullscreenElement) {
      cleanupFullscreenListeners();
      return;
    }

    document.documentElement.requestFullscreen()
      .then(() => {
        cleanupFullscreenListeners();
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.error('Fullscreen request failed:', error);
        }
      });
  };

  window.addEventListener('pointerdown', requestFullscreen);
  window.addEventListener('keydown', requestFullscreen);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
