# Полная документация Mindex

Mindex — локальный AI-планировщик задач. Пользователь входит в систему, создаёт и редактирует задачи, ведёт диалоги с Мыслью и хранит данные локально с серверной синхронизацией.

> Важно: текущий runtime проекта — local-first. Старые Telegram/Supabase описания не являются источником правды для активного сценария.

## Содержание

1. Обзор
2. Текущий стек
3. Архитектура
4. Модули frontend
5. Модули backend
6. Хранилище и auth
7. AI и чат
8. Метрики и мониторинг
9. Переменные окружения
10. Сборка и запуск
11. API эндпоинты
12. Структура репозитория

## Обзор

Приложение превращает свободный текст в структурированные задачи. Пользователь работает через локальный UI, а данные синхронизируются через серверные API. Основной сценарий построен вокруг быстрого входа, минимального трения и сохранения контекста по пользователю.

## Текущий стек

### Frontend

- React 19
- TypeScript 5.8
- Vite 6
- Motion
- Lucide React
- Tailwind CSS 4

### Backend

- Node.js 22
- Express
- Vercel Serverless Functions
- `tsx` для локального запуска `server.ts`
- `pg` для PostgreSQL
- `cors` и `dotenv`

### AI и observability

- Groq SDK
- Модель `llama-3.3-70b-versatile`
- `prom-client`
- Grafana Alloy
- Grafana Cloud remote_write

### Дополнительные библиотеки

- `@supabase/supabase-js` — оставлен в проекте как клиентский слой совместимости
- `@tailwindcss/vite`
- `@vitejs/plugin-react`
- `axios`
- `form-data`
- `motion`
- `prom-client`

## Архитектура

### Общий поток

1. Пользователь открывает приложение.
2. `src/components/LocalAuth.tsx` выполняет вход или регистрацию.
3. `src/App.tsx` загружает профиль, задачи и треды.
4. `src/lib/db.ts` читает и пишет данные через `/api/data/*`.
5. `src/components/AIChat.tsx` отправляет запросы в Groq.
6. `server.ts` инициализирует middleware, auth и `/metrics`.
7. Grafana Alloy скрейпит метрики и пушит их в Grafana Cloud.

### Два backend-слоя

В репозитории есть два способа запуска backend-кода:

- `server.ts` — основной локальный Express-сервер
- `api/*.ts` — Vercel Serverless Functions для облачного деплоя

Это сделано для совместимости с локальной разработкой и серверлесс-хостингом.

## Модули frontend

### `src/App.tsx`

Главный orchestrator приложения. Он:

- хранит активный экран
- управляет текущим пользователем
- загружает профиль, задачи и треды
- переключает `ob`, `dash`, `ai`, `threads`, `settings`
- создаёт новые треды

### `src/components/LocalAuth.tsx`

Экран локальной авторизации. Использует `src/lib/auth.ts` и поддерживает local login, регистрацию и Google login.

### `src/components/Onboarding.tsx`

Первичная настройка профиля и сохранение пользовательских настроек.

### `src/components/Dashboard.tsx`

Основной список задач, действия с задачами и переход в чат.

### `src/components/AIChat.tsx`

Интерфейс чата с Мыслью, история сообщений, planning data и генерация задач.

### `src/components/Threads.tsx`

История всех диалогов пользователя.

### `src/components/Settings.tsx`

Настройки профиля, переключатели поведения системы и выход.

### `src/components/BottomNav.tsx`

Нижняя навигация по экранам приложения.

### `src/components/TaskItem.tsx`

Карточка задачи с действиями `toggle`, `edit`, `delete`.

### `src/components/AddTaskModal.tsx` и `src/components/EditTaskModal.tsx`

Модальные окна для ручного добавления и редактирования задач.

## Модули backend

### `server.ts`

Главная точка входа локального backend. Отвечает за:

- запуск Express
- CORS
- JSON parsing
- локальную авторизацию
- CRUD по профилям, задачам и тредам
- интеграцию с Groq
- отдачу `/metrics`
- запуск Vite middleware в dev-режиме
- отдачу `dist/` в production

### `api/auth/google.ts`

Проверка Google ID token для входа через Google.

### `api/chat.ts`

Готовый AI endpoint для serverless-деплоя.

### `api/config.ts`

Возвращает клиентский конфиг, включая Google client id.

### `api/db-status.ts`

Проверка доступности БД.

### `api/bot-status.ts`, `api/setup-bot.ts`, `api/telegram.ts`, `api/webhook.ts`

Оставлены в репозитории как интеграционные serverless-модули.

## Хранилище и auth

### `src/lib/auth.ts`

Обрабатывает:

- регистрацию локального пользователя
- локальный вход
- вход через Google
- выход

После успешного входа сохраняет текущего пользователя в localStorage.

### `src/lib/db.ts`

Является клиентским слоем данных:

- читает bootstrap-пакет из `/api/data/bootstrap`
- сохраняет профиль в `/api/data/profile`
- сохраняет задачи в `/api/data/task`
- удаляет задачи через `DELETE /api/data/task/:id`
- сохраняет треды через `/api/data/thread`
- удаляет треды через `DELETE /api/data/thread/:id`

### `src/lib/storage.ts`

Изолирует данные по пользователю в `localStorage`:

- текущий пользователь
- profile
- tasks
- threads

Там же есть миграция старых ключей в per-user storage.

### `src/lib/google-auth.ts`

Проверяет Google credential на сервере.

### `src/lib/groq.ts`

Упрощает обращения к Groq из фронтенда.

### `src/lib/theme.tsx`

Тема и визуальные переменные.

### `src/lib/utils.ts`

Общие утилиты, включая генерацию UUID и форматирование.

## AI и чат

AI-слой строится вокруг Groq и модели `llama-3.3-70b-versatile`.

Поток работы:

1. Пользователь пишет свободный текст.
2. Сообщение уходит в `/api/chat` или в `server.ts`.
3. Groq возвращает структурированный ответ.
4. В ответе может быть вопросник, план или готовые шаги.
5. Чат сохраняется в `threads`, а задачи — в `tasks`.

Структура сообщений и planning data описана в `src/types.ts`.

## Метрики и мониторинг

Сервер экспортирует Prometheus-метрики на `/metrics`.

Метрики:

- `http_requests_total`
- `http_request_duration_seconds`
- `http_requests_in_flight`

Метки:

- `method`
- `route`
- `status_code`

Сбор идёт middleware-слоем, а endpoint `/metrics` исключён из самосчёта.

Grafana Alloy конфиг лежит в [monitoring/alloy/config.alloy](monitoring/alloy/config.alloy).

## Переменные окружения

### Обязательные для основной работы

- `GROQ_API_KEY`
- `DATABASE_URL`

### Для Google login

- `GOOGLE_CLIENT_ID`
- `VITE_GOOGLE_CLIENT_ID`

### Для Alloy и Grafana Cloud

- `GRAFANA_CLOUD_USER_ID`
- `GRAFANA_CLOUD_API_KEY`

### Для сервера

- `PORT`

## Сборка и запуск

### Локально

```bash
npm install
npm run dev
```

### Production preview

```bash
npm run build
npm run preview
```

### Docker

```bash
docker compose up --build -d
```

## API эндпоинты

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`

### Data

- `GET /api/data/bootstrap`
- `POST /api/data/profile`
- `POST /api/data/task`
- `DELETE /api/data/task/:id`
- `POST /api/data/thread`
- `DELETE /api/data/thread/:id`

### Chat

- `GET /api/chat`
- `POST /api/chat`

### Config и service checks

- `GET /api/config`
- `GET /api/db-status`
- `GET /api/bot-status`
- `GET /api/telegram`

### Metrics

- `GET /metrics`

## Структура репозитория

```text
Mindex/
├── api/
├── monitoring/
├── src/
│   ├── components/
│   └── lib/
├── server.ts
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
├── DOCUMENTATION.md
├── tsconfig.json
└── vercel.json
```

## Примечание по старым разделам

Если встретишь старые тексты про Telegram Mini App, Supabase realtime или серверную архитектуру старого прототипа, считай их архивом. Актуальную схему нужно сверять по `server.ts`, `src/lib/*`, `src/components/*` и `monitoring/alloy/config.alloy`.
