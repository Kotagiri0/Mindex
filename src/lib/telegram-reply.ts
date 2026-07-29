// Реплай в Telegram — пользователь жмёт «Ответить» на конкретное сообщение,
// а бот раньше это игнорировал и видел только новый текст без контекста.
// Вытаскиваем, на что именно отвечают (и точную цитату, если Telegram её даёт),
// чтобы подмешать это в текст, который уходит в ИИ.
//
// Чистая функция без сайд-эффектов — покрыта юнит-тестами
// (tests/unit/lib/telegram-reply.test.ts).

export interface TgReplyTarget {
  from?: { id?: number; first_name?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  voice?: unknown;
}

export interface TgReplyCarrier {
  reply_to_message?: TgReplyTarget;
  quote?: { text?: string };
  external_reply?: unknown;
}

export const REPLY_QUOTE_LIMIT = 400; // общий бюджет цитаты в символах (в code points)
const QUOTE_HEAD = 200;
const QUOTE_TAIL = 200;

/** Приводит сырую цитату к безопасному для подстановки в маркер виду. */
function normalizeQuote(raw: string): string | null {
  const stripped = raw
    // управляющие символы (кроме пробелов/переводов строк, которые схлопнём ниже)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, "'");

  if (!stripped) return null;

  // Режем по code points, а не code units — иначе суррогатная пара (эмодзи)
  // на границе обрезки распадается на битый символ.
  const codePoints = Array.from(stripped);
  if (codePoints.length <= REPLY_QUOTE_LIMIT) return stripped;

  const head = codePoints.slice(0, QUOTE_HEAD).join('');
  const tail = codePoints.slice(-QUOTE_TAIL).join('');
  return `${head} … ${tail}`;
}

/**
 * Собирает служебный маркер для ИИ на основе того, что пользователь
 * ответил ("Reply") на конкретное сообщение в Telegram.
 * Возвращает null, если реплая нет либо вытащить контекст не из чего.
 */
export function buildReplyContext(message: TgReplyCarrier): string | null {
  const reply = message.reply_to_message;
  if (!reply && !message.quote?.text) return null;

  // В приватном чате участников ровно двое, поэтому is_bot однозначно отличает
  // сообщение Мысли от сообщения пользователя. В группы бот не добавляется:
  // привязка идёт по chat.id, в группе getWebUserId просто не найдёт пользователя.
  const author = reply?.from?.is_bot === true ? 'bot' : reply ? 'self' : 'external';

  const quote = normalizeQuote(message.quote?.text || reply?.text || reply?.caption || '');
  if (quote) {
    if (author === 'bot') return `[Отвечает на твоё сообщение: "${quote}"]`;
    if (author === 'self') return `[Отвечает на своё сообщение: "${quote}"]`;
    return `[Отвечает на сообщение из другого чата: "${quote}"]`;
  }

  if (reply?.voice) {
    return author === 'bot'
      ? '[Отвечает на твоё голосовое сообщение]'
      : '[Отвечает на своё голосовое сообщение]';
  }

  return null;
}

// Ровно те четыре формы, что строит buildReplyContext — шире брать нельзя:
// иначе снимем начало легитимного сообщения пользователя. Синхронность
// продюсера и консьюмера закреплена round-trip тестами.
const REPLY_MARKER_RE =
  /^\[Отвечает на (?:(?:твоё|своё) сообщение: "[^\]\n]*"|сообщение из другого чата: "[^\]\n]*"|(?:твоё|своё) голосовое сообщение)\]\n/;

/**
 * Снимает служебный маркер реплая с начала текста. Нужен там, где сообщение
 * пользователя сохраняется в историю: модель маркер видит, пользователь — нет.
 */
export function stripReplyContext(text: string): string {
  return text.replace(REPLY_MARKER_RE, '');
}
