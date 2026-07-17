// Манифест интеграции Telegram Bot API. Перенесён с сохранением формата и
// имени креденшела из c:\Users\kv872\sreda-lm\integrations\telegram.json —
// см. docs/PORTING_TO_TS.md раздел 6 и src/kora/services.ts (ServiceManifest).
//
// Типизированная TS-константа, не JSON-файл: на сервере (ESM, Docker) проще
// импортировать модуль, чем читать файл с диска и парсить его при старте.

import type { ServiceManifest } from '../services.js';

export const TELEGRAM_MANIFEST: ServiceManifest = {
  name: 'telegram',
  description:
    'Telegram Bot API: сообщения от имени бота (основной канал продукта, работает из РФ без ограничений)',
  base_url: 'https://api.telegram.org/bot{token}',
  auth: { type: 'token_in_url', credential: 'telegram_bot_token' },
  actions: {
    send_message: {
      method: 'POST',
      path: '/sendMessage',
      required: ['chat_id', 'text'],
      optional: ['parse_mode', 'disable_notification'],
      write: true,
      description: 'Отправить текстовое сообщение в чат (требует подтверждения пользователя)',
    },
    get_me: {
      method: 'GET',
      path: '/getMe',
      required: [],
      optional: [],
      write: false,
      description: 'Проверить, что бот жив и токен валиден',
    },
  },
};
