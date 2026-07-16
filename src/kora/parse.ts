// Парсинг действий модели из сырого текста ответа. См. docs/PORTING_TO_TS.md
// раздел 1.1 — три ветки, каждая закрывает конкретный живой провал модели.

import type { ParsedAction } from './types.js';
import { repairJson } from './json-repair.js';
import { canonicalizeTool } from './canon.js';

// Ветка 1 — основной формат: <action tool="домен.метод">{...}</action>
const ACTION_RE = /<action\s+tool=['"]([^'"]+)['"]\s*>([\s\S]*?)<\/action>/g;

// Ветка 2 — JSON в теле тега без атрибута tool: <полисад.remember>{"key":"v"}</полисад.remember>
// Живой баг: без этой ветки действие тихо терялось, а модель рапортовала
// «сохранил», хотя вызова не было (худший класс провала — ложное подтверждение).
const TOOL_WORD = "[\\w\\p{L}]+\\.[\\w\\p{L}]+"; // ASCII + любой алфавит
const BODY_ACTION_RE = new RegExp(`<(${TOOL_WORD})>\\s*(\\{[\\s\\S]*?\\})\\s*</\\1>`, 'gu');

// Ветка 3 — оборванный тег в конце вывода: генерация упёрлась в лимит
// токенов ДО закрывающего </action>. Живой баг: модель сгенерировала
// огромный выдуманный JSON, обрыв на середине строки → основной regex
// требует закрытие → действие не распознаётся ВООБЩЕ → петля решает
// «действий нет, это финальный ответ» → пользователю в чат вываливается
// сырой <action>{полстраницы JSON...
const TRUNCATED_ACTION_RE = /<action\s+tool=['"]([^'"]+)['"]\s*>((?!<\/action>)[\s\S])*$/;

/** Парсит тело действия (JSON) через repairJson — не через голый JSON.parse,
 * потому что модель почти всегда генерирует почти-валидный JSON.
 *
 * Живой баг (kora/orchestrator.py::_parse_args): модель суёт голую строку
 * вместо JSON — <action tool="рельса.search">погода в москве</action>.
 * Ремонт тут невозможен (нет `{`), и если вернуть null, диспетчер потеряет
 * вызов, хотя намерение модели очевидно. Фолбэк на {"query": raw} — не
 * падаем, а выполняем осмысленное действие. Инструменты с другой схемой
 * отсеют такой аргумент своей pre-flight валидацией — это дешевле, чем
 * терять корректный поисковый вызов.
 */
export function parseArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // не голый валидный JSON — пробуем ремонт
  }
  const repaired = repairJson(trimmed);
  if (repaired !== null && typeof repaired === 'object' && !Array.isArray(repaired)) {
    return repaired as Record<string, unknown>;
  }
  return { query: trimmed };
}

/**
 * Извлекает все действия модели из текста ответа. Каждое действие несёт
 * И сырое имя инструмента (rawTool), И канонизированное (tool) — диспетчер
 * и дедуп работают по канону, отображение в логах может использовать сырое.
 */
export function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];

  // Ветка 1: основной формат
  const mainMatches = [...text.matchAll(ACTION_RE)];
  if (mainMatches.length > 0) {
    for (const m of mainMatches) {
      const rawTool = m[1];
      const rawBody = m[2];
      actions.push({
        rawTool,
        tool: canonicalizeTool(rawTool),
        args: parseArgs(rawBody),
        raw: rawBody,
        truncated: false,
      });
    }

    // После закрытых тегов может идти ещё один, оборванный по лимиту
    // токенов — не теряем его.
    const lastEnd = mainMatches[mainMatches.length - 1].index! + mainMatches[mainMatches.length - 1][0].length;
    const tail = text.slice(lastEnd);
    const tm = TRUNCATED_ACTION_RE.exec(tail);
    if (tm) {
      const rawTool = tm[1];
      // тело — всё после '>' сразу за tool="..."
      const bodyStart = tm[0].indexOf('>') + 1;
      const rawBody = tm[0].slice(bodyStart);
      if (rawBody.trim()) {
        actions.push({
          rawTool,
          tool: canonicalizeTool(rawTool),
          args: parseArgs(rawBody),
          raw: rawBody,
          truncated: true,
        });
      }
    }
    return actions;
  }

  // Ветка 3 (проверяем раньше ветки 2 по аналогии с python-референсом —
  // если весь текст это один оборванный action, забираем его целиком)
  const truncatedOnly = TRUNCATED_ACTION_RE.exec(text);
  if (truncatedOnly) {
    const rawTool = truncatedOnly[1];
    const bodyStart = truncatedOnly[0].indexOf('>') + 1;
    const rawBody = truncatedOnly[0].slice(bodyStart);
    if (rawBody.trim()) {
      return [{
        rawTool,
        tool: canonicalizeTool(rawTool),
        args: parseArgs(rawBody),
        raw: rawBody,
        truncated: true,
      }];
    }
  }

  // Ветка 2: JSON в теле тега без атрибута tool
  const bodyMatches = [...text.matchAll(BODY_ACTION_RE)];
  for (const m of bodyMatches) {
    const rawTool = m[1];
    const rawBody = m[2];
    actions.push({
      rawTool,
      tool: canonicalizeTool(rawTool),
      args: parseArgs(rawBody),
      raw: rawBody,
      truncated: false,
    });
  }

  return actions;
}
