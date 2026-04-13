<div align="center">
</div>

# Есть мысли?

Mindex — персональный AI-ассистент для планирования задач в локальном браузере.

## Локальный запуск

1. Установи зависимости:

```bash
npm install
```

2. Создай файл `.env` на основе `.env.example` и заполни ключи:

```bash
GROQ_API_KEY=
DATABASE_URL=postgresql://mindex:mindex@postgres:5432/mindex
```

3. Запусти dev-сервер:

```bash
npm run dev
```

Если нужен вход через Google, добавь в `.env` OAuth client id:

```bash
VITE_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_ID=
```

В Google Cloud Console нужно включить Google Identity Services и добавить `http://localhost:3000` в authorized JavaScript origins.

4. Открой приложение в браузере:

```bash
http://localhost:3000
```

Если нужен запуск собранной версии, используй:

```bash
npm run build
npm run preview
```

## Запуск в Docker

1. Подготовь `.env` (`GROQ_API_KEY` и `DATABASE_URL`).

2. Собери и подними контейнер:

```bash
docker compose up --build -d
```

3. Открой приложение:

```bash
http://localhost:3000
```

Полезные команды:

```bash
docker compose logs -f
docker compose down
```

После запуска регистрация и вход сохраняются в Postgres (`auth_users`).
