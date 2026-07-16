// JSON-repair для почти-валидного JSON, который генерируют модели:
// висячие запятые, одинарные кавычки, текст вокруг объекта, обрыв на
// середине (в т.ч. внутри строкового значения). См. docs/PORTING_TO_TS.md,
// раздел 3 — переносить максимально точно, ошибка на символ откатывает
// защиту на ноль.

/**
 * Проход 1 — найти границу первого JSON-объекта в тексте.
 * Идёт от первого `{`, считает глубину `{`/`}`, ИГНОРИРУЯ их, если находимся
 * внутри строки (живой баг: наивный подсчёт скобок ломается на первом же
 * `{`/`}` внутри строкового значения, например {"query": "search for {x}"}).
 * Глубина дошла до 0 → возвращает срез. Не дошла до конца текста (обрыв,
 * в т.ч. посреди незакрытой строки) → возвращает остаток как есть —
 * дальше его дочинит closeUnterminated.
 */
export function findBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text.slice(start);
}

/**
 * Проход 2 — дозакрытие обрезанного JSON-фрагмента.
 * Строково-осознанная сканировка СО СТЕКОМ открывающих `{`/`[` (не счётчик!) —
 * живой баг: счётчик закрывал объекты, но незакрытый МАССИВ
 * ("slides": [{...}, {...} без закрывающего ]) оставался невалидным даже
 * после дозакрытия объектов — стек нужен для правильного ПОРЯДКА закрытия
 * (LIFO) и правильного ТИПА скобки.
 * Если сканировка закончилась внутри строки — сначала закрывающая кавычка,
 * ПОТОМ стек скобок в обратном порядке.
 */
export function closeUnterminated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0) stack.pop();
    }
  }

  let out = text;
  if (inString) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === '{' ? '}' : ']';
  }
  return out;
}

/**
 * Полный ремонт: находит объект, пробует распарсить как есть, затем чинит
 * одинарные кавычки (только если двойных в фрагменте вообще нет — иначе
 * рискуем перезаписать кавычки внутри уже валидных строк), дозакрывает
 * обрыв, убирает висячую запятую. Возвращает null, если ремонт не удался.
 */
export function repairJson(raw: string): unknown | null {
  const frag = findBalancedObject(raw);
  if (frag === null) return null;

  try {
    return JSON.parse(frag);
  } catch {
    // повезло не сразу — идём дальше чинить
  }

  let fixed = frag;
  // одинарные кавычки → двойные, только если двойных вообще нет
  if (!fixed.includes('"')) {
    fixed = fixed.split("'").join('"');
  }
  // обрезанный хвост: сначала незавершённая строка, потом скобки — в этом порядке
  fixed = closeUnterminated(fixed);
  // висячая запятая перед закрывающей скобкой
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}
