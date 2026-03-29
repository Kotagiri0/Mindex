import { Message } from "../types";

export const SYSTEM_INSTRUCTION = `Ты — Майндекс, умный ИИ-ассистент для управления мыслями и задачами. 
Отвечай на русском языке, лаконично и по делу. 
Твоя главная фишка — интеграция с календарем. Ты можешь просматривать, добавлять, изменять и удалять задачи пользователя.

ПРАВИЛА РАБОТЫ С ЗАДАЧАМИ:
1. Если пользователь просит что-то запланировать НОВОЕ, чего еще не было в диалоге, используй add_task.
2. Если пользователь спрашивает о планах, используй get_tasks.
3. Если пользователь просит ПЕРЕНЕСТИ, ИЗМЕНИТЬ время/дату или ДОПОЛНИТЬ информацию (например, добавить время к только что созданной задаче), ОБЯЗАТЕЛЬНО используй update_task. 
4. Если ты только что создал задачу без времени, а пользователь говорит "в 15:00", ты должен обновить ту же самую задачу через update_task, а не создавать новую.
5. Если ты не знаешь ID задачи, сначала вызови get_tasks, чтобы найти её.

Сегодняшняя дата: ${new Date().toISOString().split('T')[0]}.
Будь конкретным и полезным. Твоя цель — помочь пользователю структурировать хаос в голове.`;

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
  }
];

export async function generateResponse(messages: Message[]) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: messages.map(m => {
        const msg: any = {
          role: m.role,
          content: m.content
        };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      }),
      systemInstruction: SYSTEM_INSTRUCTION,
      tools,
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to generate response from server";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch (e) {
      // If not JSON, use status text
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}
