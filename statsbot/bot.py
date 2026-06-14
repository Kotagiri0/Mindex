"""
Mindex Stats Bot — метрики продукта прямо в Telegram.
/stats — текущие цифры по запросу
Автодайджест в 09:00 МСК каждый день.
"""

import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

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

MSK = ZoneInfo("Europe/Moscow")


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
                  -- DAU — календарный день МСК, WAU — скользящие 7 дней МСК.
                  -- Начало текущих суток по Москве как абсолютный момент. Берём от NOW().
                  -- ВАЖНО: нельзя писать CURRENT_DATE AT TIME ZONE 'Europe/Moscow' — при сессии
                  -- БД в UTC это даёт не 00:00 МСК, а 06:00 МСК (двойной сдвиг: date→полночь UTC
                  -- →настенное МСК 03:00→обратно трактуется как UTC). Итог — отрезались первые
                  -- 6 часов суток, DAU занижался. date_trunc от NOW() в МСК так не ломается.
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE last_active_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow') AS dau,
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE last_active_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' - INTERVAL '7 days') AS wau,

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

                  -- ОБЩИЙ retention (блендованный): доля активных за последние 7 дней
                  -- среди всех, кто зарегался 7+ дней назад. Не когорта — мешает в одну кучу
                  -- и новичков, и ветеранов. Окно активности абсолютное (NOW()-7д), не от
                  -- даты регистрации. По сути «какая доля старой базы ещё жива сейчас».
                  (SELECT COUNT(*) FROM auth_users
                     WHERE created_at <= NOW() - INTERVAL '7 days')                              AS cohort_7d,
                  (SELECT COUNT(*) FROM auth_users a
                     LEFT JOIN user_profiles p ON p.user_id = a.id
                     WHERE a.created_at <= NOW() - INTERVAL '7 days'
                       AND p.last_active_at >= NOW() - INTERVAL '7 days')                        AS retained_7d,

                  -- КОГОРТНЫЙ retention (rolling): якорь — личная дата регистрации каждого.
                  -- «Дожил ли пользователь активным до дня N своей жизни» = last_active_at
                  -- не раньше, чем created_at + N дней. Знаменатель — только те, кто УСПЕЛ
                  -- прожить N дней (иначе мерить нечего). Это честная когортная метрика,
                  -- доступная без event-лога (есть только last_active_at).
                  (SELECT COUNT(*) FROM auth_users
                     WHERE created_at <= NOW() - INTERVAL '7 days')                              AS d7_eligible,
                  (SELECT COUNT(*) FROM auth_users a
                     LEFT JOIN user_profiles p ON p.user_id = a.id
                     WHERE a.created_at <= NOW() - INTERVAL '7 days'
                       AND p.last_active_at >= a.created_at + INTERVAL '7 days')                 AS d7_retained,
                  (SELECT COUNT(*) FROM auth_users
                     WHERE created_at <= NOW() - INTERVAL '30 days')                             AS d30_eligible,
                  (SELECT COUNT(*) FROM auth_users a
                     LEFT JOIN user_profiles p ON p.user_id = a.id
                     WHERE a.created_at <= NOW() - INTERVAL '30 days'
                       AND p.last_active_at >= a.created_at + INTERVAL '30 days')                AS d30_retained,

                  -- Telegram-интеграция
                  (SELECT COUNT(*) FROM user_profiles)                                           AS total_profiles,
                  (SELECT COUNT(*) FROM user_profiles
                     WHERE telegram_chat_id IS NOT NULL)                                         AS tg_connected,

                  -- Всего сообщений Мысли (assistant messages во всех тредах)
                  (SELECT COALESCE(SUM(
                     (SELECT COUNT(*) FROM jsonb_array_elements(messages) AS m
                      WHERE m->>'role' = 'assistant')
                  ), 0) FROM user_threads
                   WHERE messages IS NOT NULL AND jsonb_typeof(messages) = 'array'
                     AND jsonb_array_length(messages) > 0)                                       AS total_assistant_messages,

                  -- Сколько юзеров создали хотя бы одну задачу за сутки (старая метрика — оставлена как дополнительная)
                  (SELECT COUNT(DISTINCT user_id) FROM user_tasks
                     WHERE created_at >= NOW() - INTERVAL '1 day')                               AS task_creators_1d
            """)
            stats = dict(cur.fetchone())

            # Когорты по неделям регистрации: размер и D7 rolling-retention.
            # Считаем D7 только по тем членам недели, кто уже прожил 7 дней
            # (eligible_d7) — свежие недели показываем как «дозревает».
            cur.execute("""
                SELECT
                  to_char(date_trunc('week', a.created_at), 'DD.MM')                            AS week,
                  COUNT(*)                                                                       AS size,
                  COUNT(*) FILTER (WHERE a.created_at <= NOW() - INTERVAL '7 days')              AS eligible_d7,
                  COUNT(*) FILTER (WHERE a.created_at <= NOW() - INTERVAL '7 days'
                                     AND p.last_active_at >= a.created_at + INTERVAL '7 days')   AS retained_d7
                FROM auth_users a
                LEFT JOIN user_profiles p ON p.user_id = a.id
                WHERE a.created_at >= NOW() - INTERVAL '8 weeks'
                GROUP BY date_trunc('week', a.created_at)
                ORDER BY date_trunc('week', a.created_at) DESC
                LIMIT 6
            """)
            stats["cohorts"] = [dict(r) for r in cur.fetchall()]
            return stats


def _pct(num: int, den: int) -> str:
    return f"{round(num / den * 100)}%" if den else "—"


def format_stats(s: dict) -> str:
    dau_wau = f"{round(s['dau'] / s['wau'] * 100)}%" if s['wau'] else "—"

    # Общий (блендованный) retention — вся старая база одной кучей
    gen_cohort = s['cohort_7d'] or 0
    gen_retained = s['retained_7d'] or 0
    gen_pct = _pct(gen_retained, gen_cohort) if gen_cohort else "недостаточно данных"

    # Когортный rolling retention — якорь на личную дату регистрации
    d7_elig = s.get('d7_eligible') or 0
    d7_ret = s.get('d7_retained') or 0
    d30_elig = s.get('d30_eligible') or 0
    d30_ret = s.get('d30_retained') or 0
    d7_pct = _pct(d7_ret, d7_elig) if d7_elig else "мало данных"
    d30_pct = _pct(d30_ret, d30_elig) if d30_elig else "мало данных"

    # Таблица когорт по неделям (D7 rolling)
    cohort_lines = []
    for c in s.get('cohorts', []):
        elig = c.get('eligible_d7') or 0
        ret = c.get('retained_d7') or 0
        size = c.get('size') or 0
        if elig:
            cohort_lines.append(f"  {c['week']}: `{size}` чел → D7 `{_pct(ret, elig)}`")
        else:
            cohort_lines.append(f"  {c['week']}: `{size}` чел → _дозревает_")
    cohort_block = "\n".join(cohort_lines) if cohort_lines else "  _нет когорт за 8 недель_"

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
        f"📈 *Retention — общий* _(вся старая база)_\n"
        f"  Активны сейчас: `{gen_retained}` из `{gen_cohort}` — `{gen_pct}`\n"
        f"  _доля старой базы, живой за 7д. Растёт база → падает_\n\n"
        f"🎯 *Retention — когортный* _(rolling, от своей даты)_\n"
        f"  D7: `{d7_pct}` _(дожили активными до 7-го дня)_\n"
        f"  D30: `{d30_pct}` _(до 30-го дня)_\n\n"
        f"📅 *Когорты по неделям* _(D7 rolling)_\n"
        f"{cohort_block}\n\n"
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


async def post_init(app):
    # Запускаем планировщик ВНУТРИ event loop приложения — тогда get_event_loop() работает корректно.
    scheduler = AsyncIOScheduler(timezone=MSK, event_loop=asyncio.get_running_loop())
    scheduler.add_job(
        send_digest,
        trigger="cron",
        hour=9,
        minute=0,
        args=[app.bot],
    )
    scheduler.start()
    log.info("Scheduler started inside running loop")


def main():
    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )
    app.add_handler(CommandHandler("stats", cmd_stats))
    log.info("Stats bot started")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
