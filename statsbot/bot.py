"""
Mindex Stats Bot — метрики продукта прямо в Telegram.
/stats — текущие цифры по запросу
Автодайджест в 09:00 МСК каждый день.
"""

import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta

import psycopg2
from psycopg2.extras import RealDictCursor
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ContextTypes
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BOT_TOKEN = os.environ["STATS_BOT_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]
# Telegram ID-ы, которым разрешён доступ (через запятую)
ALLOWED_IDS = set(int(x) for x in os.environ.get("STATS_ALLOWED_IDS", "").split(",") if x.strip())
# Куда слать утренний дайджест (chat_id через запятую)
DIGEST_CHAT_IDS = [int(x) for x in os.environ.get("STATS_DIGEST_CHAT_IDS", "").split(",") if x.strip()]

MSK = timezone(timedelta(hours=3))


def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def fetch_stats() -> dict:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                  (SELECT COUNT(*) FROM auth_users)                                              AS total_users,
                  (SELECT COUNT(*) FROM auth_users WHERE created_at >= NOW() - INTERVAL '1 day') AS new_users_1d,
                  (SELECT COUNT(*) FROM auth_users WHERE created_at >= NOW() - INTERVAL '7 days') AS new_users_7d,

                  -- DAU/WAU: любой аутентифицированный запрос обновляет last_active_at в requireAuth.
                  -- DAU считается по календарному дню МСК (стандарт индустрии), WAU — скользящие 7 дней МСК.
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE last_active_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Moscow'))        AS dau,
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE last_active_at >= (CURRENT_DATE AT TIME ZONE 'Europe/Moscow') - INTERVAL '7 days') AS wau,

                  (SELECT COUNT(*) FROM user_tasks)                                              AS total_tasks,
                  (SELECT COUNT(*) FROM user_tasks WHERE created_at >= NOW() - INTERVAL '1 day') AS tasks_1d,
                  (SELECT COUNT(*) FROM user_tasks WHERE created_at >= NOW() - INTERVAL '7 days') AS tasks_7d,

                  (SELECT COUNT(*) FROM user_threads)                                            AS total_threads,
                  -- user_threads.created_at — BIGINT (миллисекунды Unix), отсюда конвертация
                  (SELECT COUNT(*) FROM user_threads
                     WHERE to_timestamp(created_at / 1000.0) >= NOW() - INTERVAL '7 days')        AS threads_7d,
                  -- Кто писал Мысли за неделю (updated_at у треда — TIMESTAMPTZ)
                  (SELECT COUNT(DISTINCT user_id) FROM user_threads
                     WHERE updated_at >= NOW() - INTERVAL '7 days')                              AS active_chatters_7d,

                  -- Retention 7d: из тех, кто зарегался 7+ дней назад, сколько вернулись за последние 7 дней
                  (SELECT COUNT(*) FROM auth_users
                     WHERE created_at <= NOW() - INTERVAL '7 days')                              AS cohort_7d,
                  (SELECT COUNT(*) FROM auth_users a
                     JOIN user_profiles p ON p.user_id = a.id
                     WHERE a.created_at <= NOW() - INTERVAL '7 days'
                       AND p.last_active_at >= NOW() - INTERVAL '7 days')                        AS retained_7d,

                  -- Telegram-интеграция
                  (SELECT COUNT(*) FROM user_profiles)                                           AS total_profiles,
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE telegram_chat_id IS NOT NULL)                                         AS tg_connected,

                  -- Всего сообщений Мысли (assistant messages во всех тредах)
                  (SELECT COALESCE(SUM(
                     (SELECT COUNT(*) FROM jsonb_array_elements(messages) AS m
                      WHERE m->>'role' = 'assistant')
                  ), 0) FROM user_threads
                   WHERE messages IS NOT NULL AND jsonb_array_length(messages) > 0)              AS total_assistant_messages,

                  -- Сколько юзеров создали хотя бы одну задачу за сутки (старая метрика — оставлена как дополнительная)
                  (SELECT COUNT(DISTINCT user_id) FROM user_tasks
                     WHERE created_at >= NOW() - INTERVAL '1 day')                               AS task_creators_1d
            """)
            return dict(cur.fetchone())


def format_stats(s: dict) -> str:
    dau_wau = f"{round(s['dau'] / s['wau'] * 100)}%" if s['wau'] else "—"
    cohort = s['cohort_7d'] or 0
    retained = s['retained_7d'] or 0
    retention_pct = f"{round(retained / cohort * 100)}%" if cohort else "недостаточно данных"
    tg_total = s['total_profiles'] or 0
    tg_conn = s['tg_connected'] or 0
    tg_pct = f"{round(tg_conn / tg_total * 100)}%" if tg_total else "—"
    now_msk = datetime.now(MSK).strftime("%d.%m.%Y %H:%M МСК")
    return (
        f"📊 *Mindex — метрики продукта*\n"
        f"_{now_msk}_\n\n"
        f"👥 *Пользователи*\n"
        f"  Всего: `{s['total_users']}`\n"
        f"  За сутки: `+{s['new_users_1d']}`\n"
        f"  За неделю: `+{s['new_users_7d']}`\n\n"
        f"🔥 *Активность*\n"
        f"  DAU: `{s['dau']}` _(заходили сегодня)_\n"
        f"  WAU: `{s['wau']}`\n"
        f"  DAU/WAU: `{dau_wau}`\n"
        f"  Писали Мысли за 7д: `{s['active_chatters_7d']}`\n"
        f"  Создавали задачи сегодня: `{s['task_creators_1d']}`\n\n"
        f"📈 *Retention 7d*\n"
        f"  Когорта (7д+): `{cohort}`\n"
        f"  Вернулись: `{retained}` — `{retention_pct}`\n\n"
        f"✉️ *Telegram-бот*\n"
        f"  Подключили: `{tg_conn}` из `{tg_total}` — `{tg_pct}`\n\n"
        f"💬 *Мысль говорит*\n"
        f"  Сообщений всего: `{s['total_assistant_messages']}`\n\n"
        f"✅ *Задачи*\n"
        f"  Всего: `{s['total_tasks']}`\n"
        f"  За сутки: `+{s['tasks_1d']}`\n"
        f"  За неделю: `+{s['tasks_7d']}`\n\n"
        f"🗂 *Треды с Мыслью*\n"
        f"  Всего: `{s['total_threads']}`\n"
        f"  За неделю: `+{s['threads_7d']}`"
    )


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if ALLOWED_IDS and user_id not in ALLOWED_IDS:
        await update.message.reply_text("⛔ Нет доступа.")
        return
    try:
        stats = fetch_stats()
        await update.message.reply_text(format_stats(stats), parse_mode="Markdown")
    except Exception as e:
        log.exception("Ошибка при получении метрик")
        await update.message.reply_text(f"❌ Ошибка: {e}")


async def send_digest(bot: Bot):
    if not DIGEST_CHAT_IDS:
        return
    try:
        stats = fetch_stats()
        text = format_stats(stats)
        for chat_id in DIGEST_CHAT_IDS:
            await bot.send_message(chat_id=chat_id, text=text, parse_mode="Markdown")
        log.info("Дайджест отправлен в %d чатов", len(DIGEST_CHAT_IDS))
    except Exception:
        log.exception("Ошибка при отправке дайджеста")


def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("stats", cmd_stats))

    scheduler = AsyncIOScheduler(timezone=MSK)
    scheduler.add_job(
        lambda: asyncio.ensure_future(send_digest(app.bot)),
        trigger="cron",
        hour=9,
        minute=0,
    )
    scheduler.start()

    log.info("Stats bot started")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
