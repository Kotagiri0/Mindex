# Есть мысли?

Mindex — локальный AI-планировщик задач с авторизацией, хранением данных по пользователям и интеграцией с Groq.

## Что внутри

- Frontend: React 19, TypeScript 5.8, Vite 6, Motion, Lucide React
- Backend: Node.js, Express, Vercel Serverless Functions, `tsx`
- Storage: `localStorage` + серверные API для профиля, задач и тредов
- AI: Groq SDK с моделью `llama-3.3-70b-versatile`
- Metrics: `prom-client` + Grafana Alloy + Grafana Cloud
- Styling: Tailwind CSS 4

## Основные модули

- `src/App.tsx` — главный экранный роутер и инициализация данных
- `src/components/LocalAuth.tsx` — локальный вход и регистрация
- `src/components/Onboarding.tsx` — первый запуск и базовые настройки
- `src/components/Dashboard.tsx` — список задач
- `src/components/AIChat.tsx` — чат с Мыслью
- `src/components/Threads.tsx` — история диалогов
- `src/components/Settings.tsx` — настройки профиля
- `src/components/BottomNav.tsx` — нижняя навигация
- `src/components/TaskItem.tsx` — карточка задачи
- `src/components/AddTaskModal.tsx` и `src/components/EditTaskModal.tsx` — модалки задач
- `src/lib/auth.ts` — local auth и Google login
- `src/lib/db.ts` — доступ к профилю, задачам и тредам через API
- `src/lib/storage.ts` — изолированное localStorage-хранилище по пользователю
- `src/lib/groq.ts` — вызовы Groq
- `src/lib/google-auth.ts` — проверка Google ID token
- `src/lib/theme.tsx` — тема и UI-настройки
- `api/chat.ts` и `server.ts` — AI-эндпоинты
- `server.ts` — основной локальный Express-сервер и Prometheus `/metrics`

## Локальный запуск

1. Установи зависимости:

```bash
npm install
```

2. Создай `.env` на основе `.env.example`.

Минимальные значения для локального запуска:

```bash
GROQ_API_KEY=
DATABASE_URL=postgresql://mindex:mindex@postgres:5432/mindex
```

Если нужен Google login, добавь:

```bash
VITE_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_ID=
```

Если нужен локальный сбор метрик и отправка в Grafana Cloud через Alloy, добавь:

```bash
GRAFANA_CLOUD_USER_ID=
GRAFANA_CLOUD_API_KEY=
```

3. Запусти сервер разработки:

```bash
npm run dev
```

4. Открой приложение:

```bash
http://localhost:3000
```

## Docker

1. Подготовь `.env`.

2. Подними стек:

```bash
docker compose up --build -d
```

3. Проверь приложение:

```bash
http://localhost:3000
```

4. Для локального мониторинга Alloy используй:

```bash
docker compose logs -f alloy
```

## Telegram-бот

Бот встроен прямо в сервер (`server-bot.ts`). Позволяет управлять задачами и общаться с Мыслью прямо в Telegram.

### Команды

- `/start` — приветствие и кнопка Mini App
- `/tasks` — задачи на сегодня с кнопками ✓
- `/add <задача>` — добавить задачу быстро
- `/clear` — очистить историю диалога
- `/app` — открыть Mini App
- `/help` — список всех команд
- любой текст — Мысль отвечает с учётом контекста и управляет задачами через tool-calling

### Локальный запуск бота

Добавь `TELEGRAM_BOT_TOKEN` в `.env` и запусти `npm run dev`. Бот автоматически включит polling-режим — ngrok не нужен.

### Деплой на Railway

1. Добавь `TELEGRAM_BOT_TOKEN`, `APP_URL` и `GROQ_API_KEY` в Railway variables
2. Задеплой
3. Открой `GET /api/setup-bot` один раз — webhook и команды зарегистрируются автоматически

Подробнее — в [DOCUMENTATION.md](DOCUMENTATION.md#telegram-бот).

## Метрики

Сервер публикует Prometheus-метрики на:

```bash
http://localhost:3000/metrics
```

Основные метрики:

- `http_requests_total`
- `http_request_duration_seconds`
- `http_requests_in_flight`

Локальный сборщик Grafana Alloy находится в [monitoring/alloy/config.alloy](monitoring/alloy/config.alloy).

## API

### Local Express server

- `GET /api/config` — конфиг клиента
- `POST /api/auth/register` — регистрация
- `POST /api/auth/login` — вход
- `POST /api/auth/google` — вход через Google
- `GET /api/data/bootstrap` — профиль, задачи и треды
- `POST /api/data/profile` — сохранить профиль
- `POST /api/data/task` — сохранить задачу
- `DELETE /api/data/task/:id` — удалить задачу
- `POST /api/data/thread` — сохранить тред
- `DELETE /api/data/thread/:id` — удалить тред
- `GET /api/chat` и `POST /api/chat` — health check и Groq chat
- `GET /metrics` — Prometheus endpoint

### Vercel functions

В репозитории также остались serverless-эндпоинты в `api/` для деплоя на Vercel и совместимости с облачным режимом.

## Важные переменные окружения

- `PORT` — порт сервера
- `DATABASE_URL` — строка подключения к PostgreSQL
- `GROQ_API_KEY` — ключ Groq
- `GOOGLE_CLIENT_ID` и `VITE_GOOGLE_CLIENT_ID` — Google OAuth client ID
- `GRAFANA_CLOUD_USER_ID` — Metrics Instance ID для Alloy
- `GRAFANA_CLOUD_API_KEY` — Grafana Cloud token для remote_write
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота
- `APP_URL` — публичный URL сервера (Railway, для webhook)
- `MINI_APP_URL` — URL Telegram Mini App

## Архитектура в двух словах

1. Пользователь входит через LocalAuth или Google.
2. Данные профиля, задач и тредов кэшируются в localStorage по пользователю.
3. Сервер отвечает за авторизацию, bootstrap и запись данных.
4. Чат отправляется в Groq.
5. Метрики снимаются через middleware и экспортируются в Prometheus формате.
6. Grafana Alloy забирает `/metrics` и отправляет их в Grafana Cloud.
