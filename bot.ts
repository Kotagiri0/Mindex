import dotenv from 'dotenv';
import { Pool } from 'pg';
import { startBot, startNotificationScheduler, startProactiveScheduler, startScheduleRunner } from './server-bot.ts';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[Bot] DATABASE_URL не задан');
  process.exit(1);
}

const db = new Pool({ connectionString: DATABASE_URL });

console.log('[Bot] Запуск автономного контейнера бота...');

startBot(db).catch(e => {
  console.error('[Bot] Критическая ошибка startBot:', e);
  process.exit(1);
});

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (botToken) {
  startNotificationScheduler(botToken, db).catch(e => console.error('[Bot] Ошибка планировщика уведомлений:', e));
  startProactiveScheduler(botToken, db);
  startScheduleRunner(botToken, db).catch(e => console.error('[Bot] Ошибка планировщика расписаний:', e));
} else {
  console.warn('[Bot] TELEGRAM_BOT_TOKEN не задан — планировщики не запущены');
}
