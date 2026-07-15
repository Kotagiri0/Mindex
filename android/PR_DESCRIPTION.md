# Нативное Android-приложение Mindex (Kotlin + Jetpack Compose)

Полный порт веб-клиента в нативное Android-приложение. Источник истины — текущий веб-код (`src/`), бэкенд используется без изменений (`https://mysle.ru`).

## Что внутри

**Архитектура** (Clean Architecture, пакет `ru.mindex.app`):
- `data/model` — модели, зеркало `types.ts` (Task, Thread, Message, PlanningData…)
- `data/network` — Retrofit + OkHttp, Bearer-авторизация, все эндпоинты API
- `data/local` — DataStore: сессия + кэш задач/тредов/профиля по userId (аналог localStorage)
- `data/repository` — Auth (Яндекс OAuth), Data (оптимистичные обновления, bootstrap), Chat (полный AI tool-loop: add_task, start_planning, update/delete, заметки, проверка конфликтов ±30 мин)
- `di/AppContainer` — ручной DI (без Hilt: маленький граф, меньше зависимостей)

**Экраны** (все из веб-версии):
- Вход через Яндекс (WebView, code-flow) → Онбординг (двухэтапное интро)
- Dashboard — список задач, недельная лента, добавление/редактирование (bottom sheets)
- Чат с Мыслью — пузыри, планирование с опросником и картой плана, голосовой ввод (MediaRecorder → /api/voice/transcribe), анимация «думает», саммари при выходе
- Мысли/Заметки — табы, поиск, переименование/удаление; заметки как треды с source «заметка»
- Сегодня — таймлайн дня с почасовой сеткой и блоками задач (порт timeline.ts)
- Календарь — месячная сетка, индикаторы задач, задачи дня
- Настройки — профиль, инструкции, выход, очистка памяти

**Дизайн-система**: Muller / Random Grotesque / Russisch Sans (в `res/font`), off-white #F9F9F9, пастельные категории задач, радиусы 8/12/16/20, фирменные иконки как ImageVector.

## Стек
Kotlin, Jetpack Compose, Material 3, Navigation Compose, ViewModel + StateFlow, Coroutines, Retrofit + OkHttp, kotlinx.serialization, DataStore, Coil. minSdk 26, target 35.

## Ограничения
- Интеграции Telegram / Google Календарь — «Скоро» (нет мобильных эндпоинтов)
- Очистка памяти — локально (нет серверного эндпоинта)
- Gradle wrapper не сгенерирован — Android Studio предложит создать при открытии `android/`
- Сборка не прогонялась (нет Android SDK в окружении) — при первом `assembleDebug` возможны мелкие правки импортов

## Как проверить
1. Открыть папку `android/` в Android Studio
2. Собрать `app` → запустить на устройстве/эмуляторе (API 26+)
3. Войти через Яндекс, пройти интро, создать мысль → задачи появятся на Dashboard/Сегодня
