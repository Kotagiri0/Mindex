import { Message } from "../types";

const _today = new Date();
const _todayStr = `${_today.getFullYear()}-${String(_today.getMonth()+1).padStart(2,'0')}-${String(_today.getDate()).padStart(2,'0')}`;

export const SYSTEM_INSTRUCTION = `Ты — Мысль, личный ассистент по организации дел и мышлению.

Отвечай только на русском. Никогда не используй эмодзи, звёздочки. Только чистый текст.

ХАРАКТЕР
Говори как умный человек, а не как сервис. Коротко, прямо, без воды. Человечно — но без слащавости и дежурных фраз. Если можно ответить одним словом — ответь одним словом.

Точки в конце: ставь точку только когда она реально нужна — в конце длинного абзаца или сложного предложения. Короткие ответы, реплики, перечисления, вопросы — без точки в конце. Чувствуй ритм текста

Никогда не начинай ответ с "Конечно!", "Отлично!", "Понял!", "Вот:" и любых других вводных. Сразу к делу

Форматирование — только когда реально помогает воспринять ответ. Список шагов — оформи списком. Простой ответ на вопрос — чистый текст. Никогда не форматируй ради форматирования

ГЛАВНЫЕ ПРАВИЛА
— Меньше слов = лучше. Каждое слово должно нести смысл
— Если чего-то не знаешь или не можешь — говори прямо. Не придумывай
— Задавай уточняющие вопросы когда контекст неполный. Один вопрос за раз, не анкету
— Учитывай всё что пользователь говорил раньше в диалоге
— Если пришёл сырой brain dump — сначала структурируй, потом уточняй детали

ВАЖНО ПРО КАЛЕНДАРЬ
— Нельзя создавать или менять события, пока пользователь не выбрал календарь
— Если календарь не выбран, сначала подключи и попроси выбрать календарь из списка
— Если пользователь просит список календарей, покажи список и попроси выбрать один по названию
— После выбора календаря подтверди его название и только потом создавай события
— Нельзя подтверждать выбор календаря, если его нет в списке календарей. Если названия нет — попроси выбрать из списка снова

ИНСТРУМЕНТЫ
Используй только предоставленные инструменты через стандартный механизм tool_calls. Не выдумывай форматы

— add_task: когда пользователь хочет добавить новую задачу
— get_tasks: когда спрашивает о планах или задачах
— update_task: когда нужно изменить, перенести или дополнить задачу. Если не знаешь ID — сначала get_tasks
— delete_task: когда нужно удалить задачу
— start_planning: когда задача сложная или многошаговая — запусти опросник для декомпозиции
— google_connect_calendar: когда пользователь просит подключить Google Calendar
— google_list_calendars: когда нужно показать список календарей
— google_select_calendar: когда пользователь выбирает календарь
— google_calendar_status: когда пользователь спрашивает, подключен ли календарь, или почему нет событий
— google_list_events: когда пользователь спрашивает про события
— google_create_event: когда нужно создать событие
— google_update_event: когда нужно изменить событие
— google_delete_event: когда нужно удалить событие

После google_connect_calendar покажи список календарей и попроси выбрать один. После ответа вызови google_select_calendar

Сегодняшняя дата: ${_todayStr}`;

export const tools: any[] = [
  {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Получить список всех задач пользователя или задач на конкретную дату.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Дата в формате YYYY-MM-DD. Если не указана, вернуть все задачи.",
          },
        },
      },
    }
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Добавить новую задачу в календарь.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Название задачи.",
          },
          time: {
            type: "string",
            description: "Время задачи в формате HH:MM (необязательно).",
          },
          date: {
            type: "string",
            description: "Дата задачи в формате YYYY-MM-DD. По умолчанию — сегодня.",
          },
        },
        required: ["name"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Обновить существующую задачу (например, отметить как выполненную или изменить время).",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID задачи.",
          },
          done: {
            type: "boolean",
            description: "Статус выполнения.",
          },
          name: {
            type: "string",
            description: "Новое название задачи.",
          },
          time: {
            type: "string",
            description: "Новое время задачи в формате HH:MM.",
          },
          date: {
            type: "string",
            description: "Новая дата задачи в формате YYYY-MM-DD.",
          },
        },
        required: ["id"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Удалить задачу из календаря.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID задачи.",
          },
        },
        required: ["id"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "start_planning",
      description: "Запускает процесс декомпозиции сложной задачи или планирования (опросник). Используй это, когда пользователь просит что-то спланировать или когда задача кажется сложной.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                question: { type: "string", description: "Текст вопроса" },
                options: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "3-4 коротких варианта ответа"
                },
              },
              required: ["id", "question", "options"]
            }
          }
        },
        required: ["questions"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "google_connect_calendar",
      description: "Запускает подключение Google Calendar через OAuth и возвращает список календарей.",
      parameters: {
        type: "object",
        properties: {},
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_list_calendars",
      description: "Получить список календарей Google пользователя.",
      parameters: {
        type: "object",
        properties: {},
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_calendar_status",
      description: "Проверить статус подключения Google Calendar и выбранный календарь.",
      parameters: {
        type: "object",
        properties: {},
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_select_calendar",
      description: "Выбрать календарь Google по ID.",
      parameters: {
        type: "object",
        properties: {
          calendarId: {
            type: "string",
            description: "ID календаря Google.",
          },
          calendarName: {
            type: "string",
            description: "Название календаря, если ID неизвестен.",
          },
        },
        required: [],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_list_events",
      description: "Получить список событий Google Calendar.",
      parameters: {
        type: "object",
        properties: {},
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_create_event",
      description: "Создать событие Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Название события." },
          date: { type: "string", description: "Дата события YYYY-MM-DD." },
          time: { type: "string", description: "Время события HH:MM (опционально)." },
          taskId: { type: "string", description: "ID связанной задачи (если есть)." },
        },
        required: ["name", "date"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_update_event",
      description: "Обновить событие Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID задачи, связанной с событием." },
          name: { type: "string", description: "Новое название." },
          date: { type: "string", description: "Новая дата YYYY-MM-DD." },
          time: { type: "string", description: "Новое время HH:MM." },
        },
        required: ["id"],
      },
    }
  },
  {
    type: "function",
    function: {
      name: "google_delete_event",
      description: "Удалить событие Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID задачи, связанной с событием." },
        },
        required: ["id"],
      },
    }
  }
];

export async function generateResponse(messages: Message[], options: { tools?: any[], tool_choice?: string } = {}) {
  // Use an absolute URL so the browser always reaches the local API endpoint.
  const apiUrl = `${window.location.origin}/api/chat`;

  console.log(`Calling AI API at: ${apiUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        messages: messages.map(m => {
          const msg: any = {
            role: m.role,
            content: m.content
          };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
          if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
          return msg;
        }),
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: options.tools !== undefined ? options.tools : tools,
        tool_choice: options.tool_choice || "auto",
      }),
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    
    if (!response.ok) {
      let errorMessage = `Server error: ${response.status} (${response.statusText})`;
      try {
        const errorData = JSON.parse(text);
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        if (text) {
          if (text.includes("<!doctype html>") || text.includes("<html>")) {
            errorMessage = "Сервер вернул HTML вместо JSON. Возможно, ошибка в маршрутизации или авторизации.";
          } else {
            errorMessage = `Server returned: ${text.slice(0, 100)}`;
          }
        }
      }
      throw new Error(errorMessage);
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON response:", text);
      if (text.includes("<!doctype html>") || text.includes("<html>")) {
        throw new Error("Ошибка: Сервер вернул HTML-страницу вместо ответа ИИ. Попробуйте перезагрузить страницу.");
      }
      throw new Error(`Ошибка парсинга ответа ИИ: ${text.slice(0, 100)}`);
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error("Превышено время ожидания ответа от ИИ (20 сек). Возможно, сервер перегружен.");
    }
    if (e.message.includes('Failed to fetch')) {
      throw new Error("Ошибка сети: Не удалось отправить запрос. Проверьте соединение и доступность локального сервера.");
    }
    throw e;
  }
}
