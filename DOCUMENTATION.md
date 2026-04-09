# 📖 Полная документация Mindex

Это полное руководство по архитектуре, структуре и работе проекта **Mindex** — персонального AI-ассистента для планирования в Telegram.

---

## 📋 Содержание

1. [Обзор проекта](#обзор-проекта)
2. [Архитектура](#архитектура)
3. [Техстек](#техстек)
4. [Структура файлов](#структура-файлов)
5. [Frontend](#frontend)
6. [Backend API](#backend-api)
7. [База данных](#база-данных)
8. [AI интеграция](#ai-интеграция)
9. [Типы данных](#типы-данных)
10. [Ключевые процессы](#ключевые-процессы)
11. [Инструкции по разработке](#инструкции-по-разработке)
12. [Известные технические нюансы](#известные-технические-нюансы)

---

## 🎯 Обзор проекта

### Что такое Mindex?

**Mindex** — это приложение для управления задачами, которое буквально спрашивает у пользователя: "Есть мысли?" и превращает свободный текст в структурированный план.

Вместо того, чтобы пользователь вручную создавал задачи в интерфейсе, он просто пишет или говорит что-то вроде:
> "Нужно сделать презентацию, провести встречу с командой, обновить спецификацию и закрыть баги"

**Система:**
1. Распознаёт это как 4 отдельные мысли
2. Выделяет цели и подзадачи
3. Предлагает план действий
4. Создаёт задачи в to-do листе

### Ключевые характеристики

- **Платформа**: Telegram Mini App + Telegram Bot
- **Модель монетизации**: 1 месяц бесплатно → 399 ₽/месяц (один тариф, без ограничений)
- **Целевая аудитория**: PM, фаундеры, предприниматели (20–50 лет, крупные города РФ)
- **Местонахождение**: Telegram — ноль трения при первом контакте
- **Уникальность**: Ноль усложнения UI, максимум персонализации через ИИ, накопление контекста

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    TELEGRAM BOT & MINI APP                  │
│                    (Frontend - React/TS)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐   ┌──────▼──────┐   ┌──▼─────┐
    │ Vercel  │   │  Supabase   │   │ Groq   │
    │ Backend │   │ (PostgreSQL)│   │ (LLM)  │
    │ (Node)  │   └─────────────┘   └────────┘
    └────┬────┘
         │
    ┌────▼────────────────────────┐
    │ API Endpoints               │
    │ - /api/chat                 │
    │ - /api/webhook              │
    │ - /api/config               │
    │ - /api/setup-bot            │
    │ - /api/telegram             │
    └─────────────────────────────┘
```

### Основные слои

**Frontend (React + TypeScript)**
- Single Page App (SPA) в Telegram Mini App
- 5 главных экранов: Onboarding, Dashboard, AIChat, Threads, Settings
- Реал-тайм синхронизация через Supabase WebSocket
- LocalStorage + IndexedDB для оффлайн работы

**Backend (Node.js + Vercel Serverless)**
- Обработка запросов от Mini App
- Интеграция с Groq API (LLM)
- Управление Telegram Bot'ом через webhook
- Синхронизация между Mini App и Bot

**Database (Supabase/PostgreSQL)**
- Таблицы: `profiles`, `tasks`, `threads`
- В каждом запросе проверка прав через `user_id`
- Реал-тайм подписки для синхронизации между браузерами/устройствами

**AI (Groq llama-3.3-70b-versatile)**
- Парсинг свободного текста в структурированные задачи
- Генерация плана действий
- Определение приоритетов и подзадач
- Запоминание контекста пользователя

---

## 🛠️ Техстек

### Frontend
- **React 19** — UI фреймворк
- **TypeScript 5.8** — типизация
- **Vite 6.2** — сборка и dev сервер (молниеносные)
- **Tailwind CSS 4.1** — стили, дизайн-система
- **Motion (Framer Motion)** — анимации
- **Lucide React** — иконки
- **Axios** — HTTP клиент
- **Supabase JS Client** — работа с БД и аутентификацией

### Backend
- **Node.js + TypeScript** — язык выполнения
- **Express** — минималистичный веб-фреймворк (для локального dev)
- **Vercel Serverless Functions** — боевой хостинг
- **Groq SDK** — интеграция с LLM API
- **CORS** — разрешение кросс-доменных запросов (критично для Telegram WebView)

### Database & Services
- **Supabase** (PostgreSQL-managed) — основная БД
- **Telegram Bot API** — webhook для входящих сообщений от пользователей
- **Groq API** — LLM для разбора текста и планирования

### Инструменты
- **TypeScript compiler (tsc)** — проверка типов
- **tsx** — быстрое выполнение TS в Node
- **Git** — версионирование (main ветка)

---

## 📁 Структура файлов

```
mindex-1/
├── CLAUDE.md                          # Конституция проекта (для AI агента)
├── DOCUMENTATION.md                    # Этот файл
├── README.md                           # Краткое описание проекта
├── package.json                        # Зависимости и скрипты
├── tsconfig.json                       # Конфигурация TypeScript
├── vite.config.ts                      # Конфигурация Vite
├── vercel.json                         # Конфигурация Vercel (CORS, rewrites)
├── server.ts                           # Dev сервер (Express, для локальной разработки)
├── .env                                # Переменные окружения (НЕ коммитить!)
│   ├── SUPABASE_URL
│   ├── SUPABASE_ANON_KEY
│   ├── GROQ_API_KEY
│   ├── TELEGRAM_BOT_TOKEN
│   └── TELEGRAM_BOT_WEBHOOK_SECRET
│
├── api/                                # Vercel Serverless Functions
│   ├── chat.ts                         # POST /api/chat — главный AI эндпоинт
│   ├── webhook.ts                      # POST /api/webhook — входящие сообщения от Bot
│   ├── telegram.ts                     # GET /api/telegram — тесты Telegram API
│   ├── setup-bot.ts                    # POST /api/setup-bot — регистрация webhook
│   ├── config.ts                       # GET /api/config — получение конфига клиентом
│   ├── bot-status.ts                   # GET /api/bot-status — статус бота
│   └── db-status.ts                    # GET /api/db-status — статус БД
│
├── src/                                # Frontend React приложение
│   ├── main.tsx                        # Entry point (Vite)
│   ├── App.tsx                         # Root компонент (главный роутинг экранов)
│   ├── types.ts                        # TypeScript интерфейсы
│   │
│   ├── lib/                            # Утилиты и сервисы
│   │   ├── db.ts                       # Слой работы с БД (Supabase abstraction)
│   │   ├── supabase.ts                 # Инициализация Supabase, парсинг Telegram данных
│   │   ├── groq.ts                     # Работа с Groq API (если нужна на frontend)
│   │   ├── storage.ts                  # LocalStorage для оффлайн режима
│   │   └── utils.ts                    # Вспомогательные функции (uuid, форматирование)
│   │
│   └── components/                     # React компоненты
│       ├── Onboarding.tsx              # Экран приветствия (заполнение профиля)
│       ├── Dashboard.tsx               # Главный экран со списком задач
│       ├── AIChat.tsx                  # Чат с "Мыслью" — главный интерфейс
│       ├── Threads.tsx                 # История всех диалогов
│       ├── Settings.tsx                # Настройки профиля
│       ├── BottomNav.tsx               # Нижняя навигация (5 кнопок)
│       ├── TaskItem.tsx                # Карточка одной задачи
│       ├── AddTaskModal.tsx            # Модальное окно создания задачи
│       └── EditTaskModal.tsx           # Модальное окно редактирования задачи
│
├── dist/                               # Собранный frontend (после `npm run build`)
└── .idea/                              # IDE конфигурация (обычно в .gitignore)
```

---

## 💻 Frontend

### App.tsx — Корневой компонент

Главный компонент, который:
1. **Инициализирует Telegram Mini App** — вызывает `tg.ready()`, `tg.expand()`
2. **Загружает профиль пользователя** — блокирует рендер до получения данных
3. **Управляет состоянием экранов** — переключение между 5 экранами
4. **Синхронизирует задачи в реал-тайме** — подписка на Supabase изменения

**Ключевые состояния:**
- `screen` — текущий активный экран (`'ob'`, `'dash'`, `'ai'`, `'threads'`, `'settings'`)
- `tasks` — список всех задач пользователя
- `threads` — история диалогов с AI
- `settings` — настройки профиля (имя, аватар, язык и т.д.)
- `curTh` — ID текущего диалога
- `loading` — флаг загрузки при инициализации

**Процесс инициализации:**
```
1. Telegram WebApp инициализация (50ms задержка для stableness)
2. Попытка получить конфиг Supabase с сервера (/api/config)
3. Ожидание Telegram User ID (до 8 сек)
4. Если ID не получен → показываем ошибку ("Открой в Telegram")
5. Запрос профиля, задач, потоков (параллельно)
6. Если онбординг не пройден → screen='ob', иначе screen='dash'
7. Запуск реал-тайм подписки на изменения задач
```

### 5 основных экранов

#### 1. **Onboarding** (`ob`)
Первый экран при первом входе. Пользователь:
- Вводит своё имя
- Выбирает настройки (автоматический режим, требовать подтверждение, уведомления)
- Нажимает "Начать"

После завершения → переход на Dashboard и `onboarding_complete=true` в БД.

#### 2. **Dashboard** (`dash`)
Главный экран со списком всех задач.

**Элементы:**
- Верхний заголовок с именем пользователя и иконкой профиля
- Список задач (отсортированы по дате и статусу)
- Кнопка "Новая мысль" (запускает новый диалог, переход на AIChat)
- Каждая задача показывает:
  - Текст задачи
  - Дату и время (если установлены)
  - Статус (сделано/не сделано)
  - Отметка через клик

**Функции:**
- Отметить задачу как сделанную (клик)
- Открыть задачу на редактирование (лонг-клик или специальная кнопка)
- Удалить задачу
- Перейти в потоки (историю диалогов)
- Открыть настройки

#### 3. **AIChat** (`ai`)
Главное место взаимодействия с "Мыслью".

**Интерфейс:**
- Верхняя часть — история сообщений (чат)
- Нижняя часть — поле ввода текста (многостроковое)
- Кнопка отправки сообщения

**Процесс:**
1. Пользователь пишет сообщение ("нужно сделать X, Y, Z")
2. Нажимает отправить
3. Сообщение отправляется на `/api/chat` (вместе с истoric чата и system prompt)
4. Groq LLM анализирует, выделяет из текста пункты, структурирует
5. Возвращает либо:
   - Вопросы для уточнения (questionnaire)
   - План действий (plan_generated)
   - Рекомендацию по созданию задач
6. На основе ответов создаются задачи в Dashboard
7. История сохраняется в `threads` таблице

#### 4. **Threads** (`threads`)
История всех прошлых диалогов.

**Элементы:**
- Список потоков, каждый показывает:
  - Название ("Новая мысль" или парсед из первого сообщения)
  - Превью первого сообщения
  - Дату создания
  - Кнопка "удалить"
- Кнопка "Новый диалог"

**Функции:**
- Клик на поток → открытие в AIChat
- Удаление потока

#### 5. **Settings** (`settings`)
Настройки профиля пользователя.

**Параметры:**
- Имя
- Аватар (фото из Telegram)
- Email (для админа)
- "Мысль автоматом создаёт задачи" (true/false)
- "Требовать подтверждение перед созданием" (true/false)
- "Включить уведомления" (true/false)

**Функции:**
- Изменение настроек
- Сохранение в Supabase (через `db.upsertProfile()`)
- Выход из профиля (logout)

### Компоненты

#### `TaskItem.tsx`
Компонент для отображения одной задачи. Принимает:
- `task` — объект Task
- `onToggle` — калбэк при клике на чекбокс
- `onEdit` — калбэк при клике на редактирование
- `onDelete` — калбэк при клике на удаление

#### `AddTaskModal.tsx` и `EditTaskModal.tsx`
Модальные окна для создания/редактирования задачи. Используются в Dashboard.

Поля:
- Название задачи
- Дата и время
- Подзадачи (опционально)

#### `BottomNav.tsx`
Нижняя навигация (5 иконок):
1. Dashboard
2. Threads
3. Новый диалог (выделен больше)
4. Settings
5. (Возможно профиль/выход)

---

## 🔌 Backend API

Все эндпоинты находятся в папке `api/` и развёрнуты как Vercel Serverless Functions.

### 1. **POST /api/chat**

Главный эндпоинт для взаимодействия с "Мыслью".

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Нужно сделать презентацию и встречу" },
    { "role": "assistant", "content": "Комбинирую в план..." },
    ...
  ],
  "systemInstruction": "Ты — 'Мысль', персональный ассистент...",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "create_task",
        "description": "Создать задачу",
        "parameters": {...}
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Response:**
```json
{
  "role": "assistant",
  "content": "Отлично! Я выделил 2 задачи из твоего сообщения:\n1. Подготовить презентацию\n2. Провести встречу с командой",
  "tool_calls": [
    {
      "id": "call_X123",
      "type": "function",
      "function": {
        "name": "create_task",
        "arguments": "{\"name\": \"Подготовить презентацию\", \"date\": \"2026-04-10\", \"time\": \"14:00\", \"priority\": \"high\"}"
      }
    }
  ]
}
```

**Логика:**
1. Берёт `GROQ_API_KEY` из env
2. Создаёт Groq клиент
3. Отправляет запрос к `llama-3.3-70b-versatile`
4. Возвращает ответ в формате OpenAI Chat Completion API
5. При ошибке возвращает 500 с описанием

### 2. **POST /api/webhook**

Входящие сообщения от Telegram Bot'а (когда пользователь пишет боту в чате).

**Что делает:**
1. Получает update от Telegram
2. Если это текстовое сообщение → перенаправляет пользователя в Mini App
3. Если это callback (нажата кнопка) → обновляет статус задачи

**Request (от Telegram):**
```json
{
  "update_id": 123456,
  "message": {
    "message_id": 1,
    "from": { "id": 987654, "first_name": "Ivan" },
    "chat": { "id": 987654 },
    "text": "Привет, создай задачу",
    "date": 1712700000
  }
}
```

**Response:**
```json
{ "ok": true }
```

### 3. **GET /api/config**

Получение конфигурации для frontend'а (Supabase URL и анон ключ).

**Request:**
```
GET /api/config
```

**Response:**
```json
{
  "supabaseUrl": "https://xxxxx.supabase.co",
  "supabaseAnonKey": "eyJhbGciOi..."
}
```

**Зачем:**
- Frontend не должен жёстко кодировать конфиг
- Позволяет менять конфиг без пересборки приложения

### 4. **POST /api/setup-bot**

Регистрация webhook для Telegram Bot'а.

**Request:**
```json
{
  "webhookUrl": "https://mindex.vercel.app/api/webhook",
  "secret": "super_secret_string"
}
```

**Response:**
```json
{ "ok": true, "message": "Webhook registered" }
```

**Примечание:** Используется один раз при первой депклои.

### 5. **GET /api/telegram**

Тестирование Telegram Bot API (проверка, доступен ли бот).

**Request:**
```
GET /api/telegram?method=getMe
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "id": 123456,
    "is_bot": true,
    "first_name": "Мысль",
    "username": "mysl_bot"
  }
}
```

### 6. **GET /api/bot-status**

Статус Telegram Bot'а.

**Response:**
```json
{
  "status": "ok",
  "botId": 123456,
  "botUsername": "mysl_bot",
  "webhookActive": true,
  "lastUpdate": "2026-04-09T10:30:00Z"
}
```

### 7. **GET /api/db-status**

Статус подключения к Supabase.

**Response:**
```json
{
  "status": "connected",
  "database": "postgres",
  "region": "eu-west-1",
  "responseTime": 42
}
```

---

## 🗄️ База данных

**Тип**: PostgreSQL (Supabase)

### Схема

#### Таблица `profiles`

```sql
create table profiles (
  id bigint primary key,                    -- Telegram user ID
  settings jsonb default '{"agent":true,"confirm":true,"notifs":true}',
  onboarding_complete boolean default false,
  updated_at timestamp with time zone default now()
);
```

**Использование:**
```typescript
const profile = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single();
```

#### Таблица `tasks`

```sql
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references profiles(id) on delete cascade,
  name text,
  time text,            -- "14:30" format
  date text,            -- "2026-04-10" format
  done boolean default false,
  type text default 'regular',  -- 'regular' | 'thought'
  subtasks jsonb default '[]',  -- Array of SubTask objects
  created_at timestamp with time zone default now()
);
```

**Использование:**
```typescript
const tasks = await supabase
  .from('tasks')
  .select('*')
  .eq('user_id', userId)
  .order('created_at', { ascending: false });
```

#### Таблица `threads`

```sql
create table threads (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references profiles(id) on delete cascade,
  title text,
  preview text,        -- First message preview
  messages jsonb default '[]',  -- Array of Message objects
  created_at timestamp with time zone default now()
);
```

**Использование:**
```typescript
const threads = await supabase
  .from('threads')
  .select('*')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(10);
```

### Реал-тайм подписки

Frontend подписывается на изменения в таблице `tasks`:

```typescript
const channel = supabase
  .channel('tasks-realtime')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'tasks',
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      // Обновляем локальное состояние
      setTasks((prev) => [payload.new, ...prev]);
    }
  )
  .subscribe();
```

### Безопасность (RLS)

На каждой таблице включены Row Level Security политики:

```sql
create policy "Users can see their own tasks"
  on tasks for select
  using (auth.uid()::bigint = user_id);

create policy "Users can create their own tasks"
  on tasks for insert
  with check (auth.uid()::bigint = user_id);
```

---

## 🤖 AI интеграция

### Groq API

**Модель:** `llama-3.3-70b-versatile`
**Провайдер:** Groq.com (быстрый LLM провайдер)

### System Prompt для "Мысли"

```
Ты — "Мысль", персональный AI-ассистент для планирования.

Твоя задача:
1. Слушать, что говорит пользователь
2. Выделять из его слов отдельные мысли и задачи
3. Структурировать их в план действий
4. Если неясно — задавать уточняющие вопросы
5. Предлагать создать задачи на основе плана

Правила поведения:
- Будь дружелюбной, но не инфантильной
- Используй русский, разговорный тон
- Без воды, максимум пользы в минимуме слов
- Понимай, что человек перегружен — не добавляй нагрузку
- Помни контекст предыдущих сообщений
- Предлагай следующий шаг, не жди вопросов

Если пользователь говорит что-то вроде:
"Нужно сделать презентацию, собрать отзывы и отправить клиенту"
→ Выдели 3 задачи:
  1. Подготовить презентацию
  2. Собрать отзывы команды
  3. Отправить презентацию клиенту
→ Предложи уточнения (когда? какой приоритет? кто помогает?)
```

### Функции (Tools)

Frontend отправляет список доступных функций (tools):

```json
[
  {
    "type": "function",
    "function": {
      "name": "create_task",
      "description": "Создать новую задачу и добавить в список",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Название задачи" },
          "date": { "type": "string", "description": "Дата в формате YYYY-MM-DD" },
          "time": { "type": "string", "description": "Время в формате HH:mm" },
          "priority": { "type": "string", "enum": ["low", "medium", "high"] }
        },
        "required": ["name"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ask_user",
      "description": "Задать пользователю вопрос для уточнения",
      "parameters": {
        "type": "object",
        "properties": {
          "question": { "type": "string", "description": "Вопрос пользователю" },
          "options": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["question"]
      }
    }
  }
]
```

Groq возвращает `tool_calls` в ответе, и frontend их обрабатывает.

---

## 📊 Типы данных

### `Task`

```typescript
export interface Task {
  id: string;           // UUID v4
  name: string;         // Описание задачи
  time: string;         // "14:30" или ""
  date: string;         // "2026-04-10"
  done: boolean;        // false = новая, true = завершена
  threadId?: string;    // ID диалога, из которого она создана (опционально)
  type?: 'regular' | 'thought';  // Тип задачи
  subtasks?: SubTask[]; // Подзадачи (опционально)
}

export interface SubTask {
  id: string;
  name: string;
  done: boolean;
}
```

### `Thread`

```typescript
export interface Thread {
  id: string;               // UUID v4
  title: string;            // "Новая мысль" или парсед
  preview: string;          // Первое сообщение
  messages: Message[];      // История диалога
  createdAt: number;        // Timestamps
}
```

### `Message`

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'tool';  // Кто это написал
  content: string;          // Текст сообщения
  time: string;             // "14:30:45"
  tool_calls?: any[];       // Функции, которые вызвал ассистент
  tool_call_id?: string;    // ID функции (если это результат)
  planning_data?: {         // Дополнительные данные для плана
    questions: {
      id: string;
      question: string;
      options: string[];
    }[];
    answers?: Record<string, string>;
    plan?: {
      title: string;
      steps: string[];
    };
    status: 'questionnaire' | 'plan_generated' | 'accepted' | 'rejected';
  };
}
```

### `Settings`

```typescript
export interface Settings {
  agent: boolean;       // Мысль автоматом создаёт задачи?
  confirm: boolean;     // Требовать подтверждение?
  notifs: boolean;      // Включить уведомления?
  name?: string;        // Имя пользователя
  avatar?: string;      // Аватар (URL)
  email?: string;       // Email админа
}
```

---

## 🔄 Ключевые процессы

### 1. Инициализация приложения

```
1. Загрузка приложения в Telegram Mini App
2. React монтирует <App /> компонент
3. Telegram WebApp инициализируется (tg.ready(), tg.expand())
4. Задержка 50ms (для stableness initDataUnsafe)
5. Запрос конфига Supabase (/api/config)
6. Ожидание Telegram User ID (до 8 сек)
7. Если ID не получен → error screen
8. Запрос профиля, задач, потоков (3 параллельных запроса)
9. Если onboarding_complete=false → screen='ob', иначе → screen='dash'
10. Запуск реал-тайм подписки на изменения в таблице tasks
11. Рендер активного экрана
```

### 2. Создание новой задачи из диалога

```
1. Пользователь пишет сообщение в AIChat
2. Frontend отправляет POST /api/chat с историей и system prompt
3. Groq анализирует текст, выделяет задачи
4. Если нужны уточнения → возвращает questions (status: questionnaire)
5. Пользователь отвечает на вопросы
6. Frontend получает tool_calls с create_task функциями
7. Frontend создаёт задачи в таблице tasks (через db.addTask)
8. Supabase отправляет уведомление на realtime канал
9. Все клиенты пользователя (если открывал в другом браузере) получают новую задачу
10. Сообщение сохраняется в таблице threads
```

### 3. Отметить задачу как сделанную

```
1. Пользователь кликает на чекбокс задачи в Dashboard
2. Frontend обновляет локальное состояние (setTasks)
3. Frontend отправляет UPDATE запрос на Supabase
4. done: true сохраняется в таблице tasks
5. Другие клиенты видят, что задача зачёркнута (через realtime)
6. Возможно: отправка уведомления в Telegram Bot ("Молодец!")
```

### 4. Синхронизация в реал-тайме

```
Сценарий: пользователь открывает приложение на двух устройствах (телефон + компьютер)

1. На телефоне: создана новая задача
2. Задача сохраняется в Supabase (tasks таблица)
3. Supabase отправляет event на realtime канал
4. Компьютер получает INSERT event
5. Frontend на компьютере вызывает setTasks() с новой задачей
6. Компьютер показывает актуальный список
```

---

## 🚀 Инструкции по разработке

### Локальная разработка

**1. Клонирование и установка**

```bash
git clone https://github.com/your-org/mindex.git
cd mindex-1
npm install
```

**2. Переменные окружения (.env)**

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GROQ_API_KEY=gsk_xxxxx...
TELEGRAM_BOT_TOKEN=123456789:ABCDefghijklmnop...
TELEGRAM_BOT_WEBHOOK_SECRET=super_secret_string
```

Не коммитить `.env` в Git! Добавить в `.gitignore`.

**3. Запуск локального dev сервера**

```bash
npm run dev
```

Это запустит:
- Express сервер на http://localhost:3000
- Vite dev сервер для frontend на http://localhost:5173

**4. Открытие в Telegram**

Локально нельзя тестировать Telegram Mini App (нужен HTTPS).

Два варианта:
- **ngrok**: expose локальный порт на интернет с HTTPS
  ```bash
  ngrok http 3000
  ```
  Затем скопировать URL в Telegram Bot @BotFather настройки.

- **Vercel preview deploy**: push на ветку, Vercel делает preview URL

### Сборка для продакшена

```bash
npm run build
```

Результат: папка `dist/` с собранным приложением.

```bash
npm run preview
```

Запускает сборанное приложение локально (для проверки).

### Git workflow

**Коммиты:**
```bash
git add .
git commit -m "Русский или английский текст"
git push origin main
```

Ветка `main` деплоится на Vercel автоматически.

**Важные правила:**
- Не коммитить `.env` (ключи)
- Коммиты на русском или английском — оба ок
- Перед удалением файла/таблицы — проверить, не используется ли

### Типизация

Проверка типов:
```bash
npm run lint
```

Это запускает `tsc --noEmit` и показывает все ошибки типов.

### Тестирование

На данный момент нет автотестов. Тестирование ручное:
1. Открыть приложение в Telegram
2. Пройти онбординг
3. Создать задачу через диалог
4. Отметить задачу
5. Открыть Threads, посмотреть историю
6. Изменить настройки

---

## 🔧 Известные технические нюансы

### 1. **Telegram WebView строже обычного браузера**

При запросе из Telegram Mini App:
- Нет CORS заголовков → запрос блокируется на клиенте
- **Решение**:
  - Backend ДОЛЖЕН возвращать `Access-Control-Allow-Origin: *`
  - В `vercel.json` это уже настроено
  - Все API функции возвращают правильные CORS заголовки

### 2. **Vercel Serverless Functions холодные**

При первом запросе функция может запускаться 1-2 сек (cold start).

**Решение:**
- Периодический пинг функции (можно через CronJob)
- Оптимизировать размер бандла функции

### 3. **Telegram initDataUnsafe может быть медленным**

На мобильном Telegram WebView иногда `initDataUnsafe` заполняется с задержкой.

**Решение:**
- Делаем loop с попытками (до 8 сек)
- Показываем загрузку, если User ID не найден

### 4. **Supabase RLS может блокировать запросы**

Если политики безопасности неправильные, операции будут падать с 403.

**Решение:**
- Проверить, что `auth.uid()` совпадает с `user_id` в таблице
- Использовать `service role` ключ на backend для системных операций (если нужно)

### 5. **LocalStorage доступно в Telegram WebView**

IndexedDB может не завести в WebView. localStorage работает.

**Решение:**
- Использовать localStorage для кэша и оффлайн данных
- Синхронизировать с Supabase при восстановлении подключения

### 6. **Groq API rate limiting**

При частых запросах может быть rate limit (429).

**Решение:**
- Добавить retry логику на frontend
- Показать пользователю "подожди..."

### 7. **Vercel deploy может быть медленным**

Push → Deploy может занять 1-3 минуты.

**Инструкция:**
- Не паниковать
- Проверить статус в Vercel dashboard
- Логи: https://vercel.com/your-project/deployments

---

## 📞 Контакты и вопросы

**Основной контакт:** Вадим Косов (vadimkosov7@gmail.com)

**Репозиторий:** GitHub mindex-1

**Дата документации:** 9 апреля 2026 г.

---

## 📝 История изменений

| Версия | Дата       | Изменения |
|--------|-----------|-----------|
| 1.0    | 9.04.2026 | Первая полная версия документации |

---

**Эта документация актуальна на момент 9 апреля 2026 года.**
