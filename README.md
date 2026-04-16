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

## Grafana Alloy без Render

Если нужен локальный сбор метрик и отправка их сразу в Grafana Cloud, используй Grafana Alloy в `docker compose`.

1. Добавь в `.env` два значения:

```bash
GRAFANA_CLOUD_USER_ID=
GRAFANA_CLOUD_API_KEY=
```

Где:
- `GRAFANA_CLOUD_USER_ID` — это **Metrics Instance ID** из Grafana Cloud (не email и не имя токена)
- `GRAFANA_CLOUD_API_KEY` — это **Cloud Access Policy token** с правом записи метрик

2. Проверь, что [monitoring/alloy/config.alloy](monitoring/alloy/config.alloy) указывает на `mindex:3000/metrics` и на правильный `remote_write` URL Grafana Cloud.

3. Подними стек:

```bash
docker compose up --build -d
```

4. Открой приложение и создай трафик:

```bash
http://localhost:3000
```

5. В Grafana Cloud проверь запрос в Explore:

```promql
sum(rate(http_requests_total[5m]))
```

Если видишь `401 Unauthorized` в логах Alloy:
- проверь, что `GRAFANA_CLOUD_USER_ID` действительно равен Metrics Instance ID
- проверь, что токен не отозван и имеет нужные права
- убедись, что нет лишних пробелов/кавычек в `.env`
- после изменения `.env` перезапусти стек: `docker compose down && docker compose up -d`

Для локальной схемы Render не нужен: Alloy скрейпит контейнер приложения напрямую по внутренней сети Docker и пушит метрики в Grafana Cloud.

## Prometheus + Grafana Cloud (Render)

Ниже минимальная production-схема для Render: Prometheus скрейпит `https://<твой-сервис>/metrics` и отправляет данные в Grafana Cloud через `remote_write`.

Важно по безопасности: если API key уже публиковался, сразу перевыпусти его в Grafana Cloud и используй новый.

1. Подготовь конфиг на основе шаблона [monitoring/prometheus.render.yml](monitoring/prometheus.render.yml):
	- `__GRAFANA_CLOUD_USER_ID__` -> твой `username` из Grafana Cloud
	- `__GRAFANA_CLOUD_API_KEY__` -> новый API key
	- `__RENDER_SERVICE_DOMAIN__` -> домен твоего Render веб-сервиса без `https://`

2. Проверь, что endpoint метрик доступен:

```bash
curl https://<твой-render-домен>/metrics
```

3. Разверни отдельный сервис Prometheus на Render (второй сервис рядом с приложением):
	- Runtime: Docker
	- Image: `prom/prometheus:v2.54.1`
	- Start command:

```bash
--config.file=/etc/prometheus/prometheus.yml --web.listen-address=:9090
```

4. В этот сервис положи подготовленный конфиг как `/etc/prometheus/prometheus.yml`.

5. Проверь ingestion в Grafana Cloud:
	- В Grafana Explore выполни запрос: `sum(rate(http_requests_total[5m]))`
	- Если данных нет, проверь логи Prometheus (ошибки `remote_write` и `scrape`).

Подсказка по target: указывать нужно хост и порт, без `https://` и без `/metrics`.
