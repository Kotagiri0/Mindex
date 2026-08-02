export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Безопасный разбор JSON-аргументов tool_call от модели.
 *
 * Обрыв ответа на max_tokens (server.ts) режет аргумент последнего вызова
 * посреди строки — JSON.parse на нём кидает исключение. Раньше это
 * необработанное исключение рвало весь цикл обработки хода в AIChat.tsx/
 * DesktopApp.tsx: часть задач уже сохранена, остальные терялись, пользователь
 * видел сырой текст JS-ошибки. Явный результат вместо throw позволяет
 * вызывающему коду пропустить именно сломанный вызов и обработать остальные
 * в том же ответе модели.
 */
export function safeParseToolArgs(rawArguments: string): { ok: true; args: any } | { ok: false; error: unknown } {
  try {
    return { ok: true, args: JSON.parse(rawArguments) };
  } catch (error) {
    return { ok: false, error };
  }
}
