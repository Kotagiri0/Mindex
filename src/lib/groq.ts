import { Message } from "../types";

export const SYSTEM_INSTRUCTION = `Ты — ассистент по имени "Мысль". Твоя цель — помогать пользователю организовывать дела, превращая хаос мыслей в четкие планы.
Отвечай на русском языке, лаконично и по делу.

Если пользователь просит помочь с чем-то сложным, спланировать проект или разбить задачу на шаги, ты ДОЛЖЕН использовать инструмент 'start_planning'.
Этот инструмент запустит интерактивный опросник, чтобы уточнить детали.

ПРАВИЛА ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
1. Используй только предоставленные инструменты.
2. НЕ выдумывай свой формат вызова функций (например, <function=...>), используй стандартный механизм tool_calls.
3. Если пользователь просит что-то запланировать НОВОЕ, чего еще не было в диалоге, используй add_task.
4. Если пользователь спрашивает о планах, используй get_tasks.
5. Если пользователь просит ПЕРЕНЕСТИ, ИЗМЕНИТЬ время/дату или ДОПОЛНИТЬ информацию, ОБЯЗАТЕЛЬНО используй update_task.
6. Если ты не знаешь ID задачи, сначала вызови get_tasks, чтобы найти её.

Сегодняшняя дата: ${new Date().toISOString().split('T')[0]}.`;

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
  }
];

function sanitizeHistory(messages: Message[]): Message[] {
  // Remove tool_calls assistant messages that don't have a matching tool result right after
  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.tool_calls) {
      const next = messages[i + 1];
      if (!next || next.role !== 'tool') continue; // skip orphan tool_calls
    }
    if (m.role === 'tool' && !m.content) continue; // skip tool messages with empty content
    result.push(m);
  }
  return result;
}

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
        messages: sanitizeHistory(messages).map(m => {
          const msg: any = {
            role: m.role,
            content: m.content ?? ''
          };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
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
