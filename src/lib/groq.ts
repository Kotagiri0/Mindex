import { Message } from "../types";
import { getCurrentUser } from "./auth";

export async function generateResponse(messages: Message[]) {
  const apiUrl = `${window.location.origin}/api/chat`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

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
          const msg: any = { role: m.role, content: m.content };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
          if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
          return msg;
        }),
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
      } catch {
        if (text?.includes("<!doctype html>") || text?.includes("<html>")) {
          errorMessage = "Сервер вернул HTML вместо JSON. Возможно, ошибка в маршрутизации или авторизации.";
        } else if (text) {
          errorMessage = `Server returned: ${text.slice(0, 100)}`;
        }
      }
      throw new Error(errorMessage);
    }

    try {
      return JSON.parse(text);
    } catch {
      if (text?.includes("<!doctype html>") || text?.includes("<html>")) {
        throw new Error("Ошибка: Сервер вернул HTML-страницу вместо ответа ИИ. Попробуйте перезагрузить страницу.");
      }
      throw new Error(`Ошибка парсинга ответа ИИ: ${text?.slice(0, 100)}`);
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error("Превышено время ожидания ответа от ИИ (20 сек). Возможно, сервер перегружен.");
    }
    if (e.message?.includes('Failed to fetch')) {
      throw new Error("Ошибка сети: Не удалось отправить запрос. Проверьте соединение и доступность локального сервера.");
    }
    throw e;
  }
}
