// Платформа. iOS Safari/WebKit обрабатывает экранную клавиатуру иначе, чем
// Android Chrome: не сжимает layout viewport, а скроллит документ вверх и даёт
// «дрейф» при панорамировании. Для iOS включаем отдельный фикс вьюпорта —
// прибиваем body к visualViewport (см. index.css .ios-kbd-fix и App.tsx).
export const isIOS: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ маскируется под macOS — ловим по тач-поинтам
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
})();
