// Состояние ОДНОГО хода (turn) агентного харнесса КОРА. См.
// docs/PORTING_TO_TS.md раздел 2 (guardrails 3-6).
//
// Сервер многопользовательский — никакого глобального изменяемого состояния.
// TurnState создаётся заново на каждый запрос (на каждый ход диалога) и
// передаётся явно в guardrails. Ничего здесь не переживает конец хода.

/** Лимиты вызовов на инструмент за один ход. Значения — из
 * kora/orchestrator.py::_TOOL_BUDGET (живой баг: hermes сделал 25 поисков
 * за ход в exp_03). Дефолт для инструментов, которых нет в таблице — 5. */
export const TOOL_BUDGET: Record<string, number> = {
  'рельса.search': 4,
  'рельса.scrape_url': 3,
  'полисад.search': 3,
  'полисад.remember': 3,
  'навык.list': 2,
  'навык.load': 4,
  'артефакт.slides': 2,
  'артефакт.site': 2,
  'сервис.list': 2,
  'сервис.call': 3,
};

export const BUDGET_DEFAULT = 5;

/** Рекурсивная сортировка ключей — эквивалент json.dumps(sort_keys=True) в
 * Python-референсе: сортирует и вложенные объекты, иначе args с
 * переставленными ключами на втором уровне ускользают от дедупа. */
function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = deepSort((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Создаёт ключ дедупа: канон.имя + JSON рекурсивно отсортированных args —
 * {"a":1,"b":{"d":1,"c":2}} и {"b":{"c":2,"d":1},"a":1} считаются одним
 * и тем же вызовом. */
export function callKey(canonTool: string, args: Record<string, unknown>): string {
  return `${canonTool}::${JSON.stringify(deepSort(args))}`;
}

/** Состояние одного хода. Живёт от начала запроса до отправки ответа
 * пользователю, затем выбрасывается. */
export class TurnState {
  /** Ключи уже выполненных (не заблокированных) вызовов — для дедупа (G3). */
  readonly seenCalls = new Set<string>();

  /** Счётчик вызовов по КАНОНИЧЕСКОМУ имени инструмента — для бюджета (G4). */
  readonly usedBudget = new Map<string, number>();

  /** Несжимаемый лог реальных результатов инструментов (JSON-строки) и
   * текста пользователя — единственный источник правды для guardrails
   * 5/6 (remember-guard, write-payload-guard) и антифабрикации URL. */
  readonly evidenceParts: string[] = [];

  /** Текст исходного сообщения пользователя этого хода — для проверки
   * "явной просьбы запомнить" и URL, упомянутых самим пользователем. */
  userMsg = '';

  /** Счётчик провалов подряд (эскалация, guardrail 7 — не реализован в
   * этой фазе, но поле нужно другим фазам, держим здесь для совместимости
   * структуры состояния). */
  consecutiveFailures = 0;

  constructor(userMsg = '') {
    this.userMsg = userMsg;
  }

  /** Совокупный evidence одной строкой — то, с чем сверяются URL. */
  get evidence(): string {
    return this.evidenceParts.join('\n');
  }

  /** Отметить вызов как выполненный (для будущего дедупа) и потратить
   * единицу бюджета инструмента. Вызывается ПОСЛЕ прохождения всех
   * пре-колл guardrails, перед реальным вызовом инструмента. */
  recordCall(key: string, canonTool: string): void {
    this.seenCalls.add(key);
    this.usedBudget.set(canonTool, (this.usedBudget.get(canonTool) ?? 0) + 1);
  }

  /** Добавить успешный результат инструмента в evidence-буфер. */
  addEvidence(resultJson: string): void {
    this.evidenceParts.push(resultJson);
  }
}
