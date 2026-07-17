// Реестр инструментов КОРЫ. См. docs/PORTING_TO_TS.md раздел 1.3 и
// kora/tools.py (REGISTRY + TOOL_SPECS/validate_args) как референс.
//
// Живой баг (раздел 1.2): диспетчер должен получать и искать инструмент по
// КАНОНИЧЕСКОМУ имени (canonicalizeTool), не по сырому — иначе "неизвестный
// инструмент" на распознанном, но не канонизированном для диспетчера вызове.
// Реестр здесь НЕ канонизирует сам — это ответственность вызывающего кода
// (диспетчера), реестр лишь документирует это требование в get().
//
// Многопользовательский сервер: реестр — иммутабельная (после регистрации)
// структура, без глобального синглтона с общей мутацией между запросами.
// Разным пользователям соответствуют разные наборы инструментов (выключенные
// интеграции) — для этого subset() создаёт НЕЗАВИСИМЫЙ реестр с подмножеством
// инструментов, не завязанный на исходный.

/** Тип одного аргумента инструмента — используется и для валидации, и для
 * генерации JSON-схемы в системном промпте. */
export type ArgType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ArgSpec {
  type: ArgType;
  required: boolean;
  description: string;
  /** Для строк: максимальная длина — более длинное значение молча
   * ОБРЕЗАЕТСЯ, не отклоняется (kora/tools.py: для поисковых запросов
   * усечение почти всегда лучше потерянного хода). */
  maxLen?: number;
  /** Для чисел: [min, max] — значение вне диапазона зажимается (clamp),
   * не отклоняется. */
  range?: [number, number];
}

/** Определение одного инструмента. execute в этой фазе не вызывается нигде
 * (реальные реализации — Фаза 6), но тип уже должен быть готов под них. */
export interface ToolDef<TCtx = unknown> {
  /** Канонический формат "домен.метод" (см. canon.ts). */
  name: string;
  description: string;
  argsSchema: Record<string, ArgSpec>;
  /** true — write-действие, подлежит HITL-гейту (раздел 5 ТЗ), в этой фазе
   * поле только хранится, диспетчеризация гейта — отдельная фаза. */
  isWrite: boolean;
  execute: (args: Record<string, unknown>, ctx: TCtx) => Promise<unknown>;
}

export class ToolRegistry<TCtx = unknown> {
  private readonly tools = new Map<string, ToolDef<TCtx>>();

  /** Регистрирует инструмент. Повторная регистрация того же name
   * перезаписывает предыдущее определение (последний регистрирующий
   * побеждает — удобно для тестов/override, без скрытых исключений). */
  register(def: ToolDef<TCtx>): void {
    this.tools.set(def.name, def);
  }

  /** Ищет инструмент СТРОГО по каноническому имени. Сырое имя модели нужно
   * прогонять через canonicalizeTool() ДО вызова этого метода — реестр
   * сознательно не делает этого сам, чтобы канонизация оставалась в одном
   * месте (canon.ts) и не расходилась между диспетчером и реестром. */
  get(canonName: string): ToolDef<TCtx> | undefined {
    return this.tools.get(canonName);
  }

  has(canonName: string): boolean {
    return this.tools.has(canonName);
  }

  list(): ToolDef<TCtx>[] {
    return Array.from(this.tools.values());
  }

  /** Создаёт НЕЗАВИСИМЫЙ реестр с подмножеством инструментов (по имени).
   * Неизвестные имена молча пропускаются — вызывающий код сам решает,
   * предупреждать об этом или нет (это персонализация набора инструментов
   * пользователя, не программная ошибка). */
  subset(names: string[]): ToolRegistry<TCtx> {
    const out = new ToolRegistry<TCtx>();
    for (const name of names) {
      const def = this.tools.get(name);
      if (def) out.register(def);
    }
    return out;
  }
}

export type ValidateResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

/** Pre-flight валидация аргументов ДО диспатча (kora/tools.py::validate_args).
 *
 * Семантика референса (Anthropic tool-use guide / BFCL: у 3B-моделей до 30%
 * вызовов приходят с битыми аргументами — отказывать на каждый значит жечь
 * шаги и бюджет впустую): чиним, что чинится детерминированно, отказываем
 * только там, где чинить нечем.
 *   - нет обязательного поля  → отказ с шаблоном правильного вызова
 *   - строка длиннее maxLen   → молча обрезаем
 *   - число вне range         → зажимаем в границы (clamp)
 *   - число не приводится     → выкидываем ключ (возьмётся дефолт инструмента)
 *   - примитив в string-поле  → приводим String(val)
 *
 * В отличие от Python вход НЕ мутируется — возвращается исправленная копия
 * (сервер многопользовательский, скрытая мутация чужого объекта опасна). */
export function validateArgs(def: ToolDef<unknown>, args: Record<string, unknown>): ValidateResult {
  const fixed: Record<string, unknown> = { ...args };

  for (const [field, spec] of Object.entries(def.argsSchema)) {
    let val = fixed[field];
    const present = val !== undefined && val !== null && !(typeof val === 'string' && val === '');

    if (spec.required && !present) {
      const example = spec.type === 'string' ? `"${spec.description || 'значение'}"` : `<${spec.type}>`;
      return {
        ok: false,
        error:
          `не хватает обязательного поля "${field}". ` +
          `Формат вызова: {"${field}": ${example}}`,
      };
    }
    if (!present) continue;

    if (spec.type === 'string') {
      // примитив не-строка → приводим; объект/массив чинить нечем — отказ
      if (typeof val !== 'string') {
        if (typeof val === 'number' || typeof val === 'boolean') {
          val = String(val);
        } else {
          return { ok: false, error: `поле "${field}" должно быть строкой` };
        }
      }
      if (spec.maxLen && (val as string).length > spec.maxLen) {
        val = (val as string).slice(0, spec.maxLen);
      }
      fixed[field] = val;
    } else if (spec.type === 'number') {
      const n = typeof val === 'number' ? val : Number(val);
      if (Number.isNaN(n)) {
        delete fixed[field]; // не число вообще — пусть возьмётся дефолт
        continue;
      }
      fixed[field] = spec.range ? Math.max(spec.range[0], Math.min(spec.range[1], n)) : n;
    }
    // boolean/object/array — принимаем как есть: референс их не проверял,
    // инструмент сам отсеет неподходящее своей логикой
  }

  return { ok: true, args: fixed };
}
