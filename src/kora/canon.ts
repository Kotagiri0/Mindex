// Канонизация имени инструмента. См. docs/PORTING_TO_TS.md раздел 1.2.
//
// Живой баг: модель путает р/r (кириллица/латиница визуально похожи),
// генерит транслит и опечатки в методе ("rельса.search", "relsa.search").
// Канонизация — по первой букве домена + ключевым корням метода, не точное
// совпадение. КРИТИЧНО: диспетчер и дедуп повторных вызовов работают ИМЕННО
// по каноническому имени — иначе "неизвестный инструмент" на распознанном,
// но не канонизированном для диспетчера вызове, либо дубли, ускользающие от
// дедупа (rельса.search и рельса.search с одинаковыми args должны давать
// один и тот же канон).

/**
 * Канонизирует сырое имя инструмента к формату "домен.метод".
 * Тотальная и детерминированная: на неизвестный домен возвращает исходную
 * строку как есть (dispatch дальше сам решит, что это «неизвестный
 * инструмент») — это осознанный фолбэк, не потеря данных.
 */
export function canonicalizeTool(raw: string): string {
  const t = raw.toLowerCase();
  const dotIdx = t.indexOf('.');
  const domainRaw = dotIdx === -1 ? t : t.slice(0, dotIdx);
  let method = dotIdx === -1 ? '' : t.slice(dotIdx + 1);

  const first = domainRaw.slice(0, 1);
  let domain: string;
  if (first === 'р' || first === 'r') {
    domain = 'рельса';
  } else if (first === 'п' || first === 'p') {
    domain = 'полисад';
  } else if (first === 'н' || first === 'n') {
    domain = 'навык';
  } else if (first === 'а' || first === 'a') {
    domain = 'артефакт';
  } else if (first === 'с' || first === 's' || first === 'c') {
    domain = 'сервис';
  } else {
    // домен не угадали — отдаём исходную строку как есть
    return raw;
  }

  // нормализуем метод по ключевым корням
  if (method.includes('scrape')) {
    method = 'scrape_url';
  } else if (method.includes('remember') || method.includes('store')) {
    method = 'remember';
  } else if (method.includes('search') || method.includes('recall')) {
    method = 'search';
  } else if (method.includes('slide') || method.includes('презентац')) {
    method = 'slides';
  } else if (method.includes('site') || method.includes('сайт') || method.includes('page')) {
    method = 'site';
  } else if (method.includes('call') || method.includes('выполн')) {
    method = 'call';
  } else if (method.includes('load') || method.includes('get')) {
    method = 'load';
  } else if (method.includes('list')) {
    method = 'list';
  }

  return method ? `${domain}.${method}` : raw;
}
