import { Message } from "../types";
import { getCurrentUser } from "./auth";

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

ИНСТРУМЕНТЫ
Используй только предоставленные инструменты через стандартный механизм tool_calls. Не выдумывай форматы

— add_task: когда пользователь хочет добавить новую задачу
— get_tasks: когда спрашивает о планах или задачах
— update_task: когда нужно изменить, перенести или дополнить задачу. Если не знаешь ID — сначала get_tasks
— delete_task: когда нужно удалить задачу
— start_planning: когда задача сложная или многошаговая — запусти опросник для декомпозиции
— save_as_note: когда пользователь просит сохранить что-то как заметку (своё сообщение, твой ответ, любой текст). Придумай подходящее название

GOOGLE КАЛЕНДАРЬ
Если пользователь подключил Google Календарь в настройках, задачи с датой автоматически появляются в его Google Календаре при создании или обновлении через add_task / update_task. Никогда не говори пользователю, что ты не можешь добавить событие в Google Календарь — просто создай или обнови задачу как обычно, и она сама туда попадёт. При создании задачи можно передать поля description (описание) и location (место/адрес) — они тоже отобразятся в Google Календаре.

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
      description: "Добавить новую задачу в планировщик. Если подключён Google Календарь — задача автоматически появится там.",
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
          description: {
            type: "string",
            description: "Описание задачи (необязательно). Отображается в Google Календаре.",
          },
          location: {
            type: "string",
            description: "Место или адрес (необязательно). Отображается в Google Календаре.",
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
      description: "Обновить существующую задачу (например, отметить как выполненную или изменить время). Изменения автоматически синхронизируются с Google Календарём если он подключён.",
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
          description: {
            type: "string",
            description: "Описание задачи. Отображается в Google Календаре.",
          },
          location: {
            type: "string",
            description: "Место или адрес. Отображается в Google Календаре.",
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
      name: "save_as_note",
      description: "Сохранить текст как отдельную заметку в архив. Используй когда пользователь просит сохранить что-то как заметку — своё сообщение, твой ответ или любой другой текст. Можешь сам переименовать заметку исходя из контекста.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Текст заметки для сохранения.",
          },
          title: {
            type: "string",
            description: "Название заметки. Придумай короткое и точное название исходя из содержимого (3-5 слов).",
          },
        },
        required: ["content", "title"],
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
        userId: getCurrentUser()?.id,
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
