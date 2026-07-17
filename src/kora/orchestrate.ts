// Оркестрация: декомпозиция → параллельные подзадачи → синтез. См.
// docs/PORTING_TO_TS.md раздел 7 и kora/orchestrator.py::_needs_decomposition/
// _parse_plan/_orchestrate как построчный референс.
//
// Живой урок из HANDOFF: в референсе оркестрация покрыта юнит-тестами, но НЕ
// боевым бенчмарком — доказанность на уровень ниже, чем у остальной петли.
// Поэтому здесь не добавляется никакой механики сверх референса (никакой
// "умной" балансировки воркеров, ретраев планировщика и т.п.) — переносим
// ровно то, что было проверено, не больше.

import type { GenerateFn, LoopEvent, LoopResult, RunReactLoopOptions } from './loop.js';
import { runReactLoop } from './loop.js';
import { sanitizeFinalAnswer, stripFakeResults } from './guards.js';
import { TurnState } from './turn-state.js';
import type { ToolRegistry } from './registry.js';

// ─── 1. Детектор составности ───────────────────────────────────────────────
// Консервативный regex по русским маркерам составности (сверено с
// kora/orchestrator.py::_DECOMP_RE). Живой урок: ложное срабатывание стоит
// 3+ лишних вызова модели (план + N подзадач + синтез) вместо одного —
// при малейшем сомнении НЕ запускаем оркестрацию, падаем в обычную петлю.
//
// Важно: в отличие от FRESH_RE (loop.ts) здесь НЕ нужен кириллический
// lookbehind-эквивалент \b — маркеры референса уже все "префиксы слова"
// (сводк-, дайджест, по кажд-о...), которые начинаются с начала слова по
// построению самого паттерна (напр. "по каждо" внутри фразы), а не через \b.
// Единственное место, где реально нужна граница, — "сравни X и Y": маркер
// "сравни .+ (и|с) " задаёт границу пробелами в самом паттерне, \b не нужен.
const DECOMP_RE =
  /(сводк|дайджест|по каждо|по всем трём|по обоим|сравни .+ (и|с) |^\s*разбей|несколько задач)/iu;

// Явный нумерованный/буллет-список из 2+ пунктов в сообщении пользователя —
// тоже маркер составности (референс: bullets regex + len>=2).
const BULLET_RE = /(?:^|\n)\s*(?:[-•]|\d+[.)])\s+\S/gm;

export function isComposite(userMsg: string): boolean {
  if (DECOMP_RE.test(userMsg)) return true;
  const bullets = userMsg.match(BULLET_RE);
  return (bullets?.length ?? 0) >= 2;
}

// ─── 2. Планировщик ─────────────────────────────────────────────────────────
// Потолок ширины плана: план длиннее почти всегда шум (референс: 3B-модели
// генерируют "план" из 8 пунктов, где половина — пересказ того же).
const MAX_SUBTASKS = 4;
// Подзадача уже атомарна — длинная петля ей не нужна (референс: _SUBTASK_STEPS).
const SUBTASK_STEPS = 3;

const PLAN_SYSTEM_PROMPT = 'Ты планировщик. Отвечай только пронумерованным списком.';

function buildPlanPrompt(goal: string): string {
  return (
    `Разбей цель пользователя на 2–${MAX_SUBTASKS} НЕЗАВИСИМЫХ подзадачи. Правила:\n` +
    '- каждая подзадача самодостаточна (исполнитель не видит соседних);\n' +
    '- формат СТРОГО: каждая с новой строки как «1. текст», «2. текст»;\n' +
    '- никакого другого текста, только пронумерованные строки.\n\n' +
    `Цель: ${goal}`
  );
}

const PLAN_LINE_RE = /^\s*\d+[.)]\s+(.+?)\s*$/gm;

/**
 * Строки вида «1. подзадача» из вывода модели-планировщика. Мусор вокруг
 * игнорируем (regex ищет построчно, не требует, чтобы весь текст состоял
 * только из списка). Меньше двух распарсенных пунктов → план не удался,
 * пустой массив — это ШТАТНЫЙ путь (тихий откат на обычную петлю), не ошибка.
 */
export async function planSubtasks(
  userMsg: string,
  generate: GenerateFn,
  signal?: AbortSignal
): Promise<string[]> {
  const out = await generate(
    [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: buildPlanPrompt(userMsg) },
    ],
    { signal }
  );

  const subtasks: string[] = [];
  for (const m of out.matchAll(PLAN_LINE_RE)) {
    const item = m[1].trim();
    if (item && !subtasks.includes(item)) subtasks.push(item);
  }
  const capped = subtasks.slice(0, MAX_SUBTASKS);
  return capped.length < 2 ? [] : capped;
}

// ─── 3. Параллельное исполнение подзадач ───────────────────────────────────

export interface SubtaskResult {
  index: number;
  task: string;
  answer: string;
  /** true — подзадача не вернула непустого ответа (в т.ч. упала исключением). */
  failed: boolean;
  turnState?: TurnState;
  error?: string;
}

/**
 * Одна подзадача — своим runReactLoop с ЧИСТЫМ контекстом (history: [],
 * не видит исходного диалога и соседних подзадач), коротким maxSteps и БЕЗ
 * write-инструментов (registry.subset() только read: def.isWrite === false)
 * — суб-агент не может поставить write-действие в очередь подтверждения из
 * параллельного потока, вопрос подтверждения в параллели не имеет смысла.
 * Без вложенной декомпозиции — просто не вызывает runOrchestrated, это и
 * так так (не передаём никакого способа для суб-агента рекурсивно уйти
 * в оркестрацию).
 */
async function runSingleSubtask<TCtx>(
  task: string,
  index: number,
  registry: ToolRegistry<TCtx>,
  generate: GenerateFn,
  ctx: TCtx,
  signal: AbortSignal | undefined,
  onEvent: ((evt: LoopEvent) => void) | undefined
): Promise<SubtaskResult> {
  try {
    const readOnlyNames = registry.list().filter((d) => !d.isWrite).map((d) => d.name);
    const readOnlyRegistry = registry.subset(readOnlyNames);

    const result = await runReactLoop({
      userMsg: task,
      history: [],
      registry: readOnlyRegistry,
      generate,
      ctx,
      maxSteps: SUBTASK_STEPS,
      signal,
      onEvent: onEvent ? (evt) => onEvent({ ...evt, subtask: index }) : undefined,
    });

    const answer = (result.answer || '').trim();
    return { index, task, answer, failed: !answer, turnState: result.turnState };
  } catch (e) {
    return {
      index,
      task,
      answer: '',
      failed: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Запускает все подзадачи параллельно. onSubtaskDone вызывается СРАЗУ по
 * завершении каждой (через .then на индивидуальном промисе, до общего
 * await) — живой граф прогресса должен обновляться по мере готовности, не
 * пост-фактум одним снапшотом. Promise.allSettled снаружи — подстраховка:
 * runSingleSubtask уже ловит все исключения сама, но allSettled гарантирует,
 * что даже неожиданный throw (например, в самом .then-колбэке) не уронит
 * весь оркестратор одним необработанным rejection.
 */
async function runSubtasksParallel<TCtx>(
  subtasks: string[],
  registry: ToolRegistry<TCtx>,
  generate: GenerateFn,
  ctx: TCtx,
  signal: AbortSignal | undefined,
  onEvent: ((evt: LoopEvent) => void) | undefined,
  onSubtaskDone: ((index: number, result: SubtaskResult) => void) | undefined
): Promise<SubtaskResult[]> {
  const promises = subtasks.map((task, index) =>
    runSingleSubtask(task, index, registry, generate, ctx, signal, onEvent).then((result) => {
      onSubtaskDone?.(index, result);
      return result;
    })
  );

  const settled = await Promise.allSettled(promises);
  return settled.map((s, index) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          index,
          task: subtasks[index],
          answer: '',
          failed: true,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        }
  );
}

// ─── 4. Синтез ──────────────────────────────────────────────────────────────

const SYNTH_FALLBACK_SYSTEM_PROMPT = 'Собери итоговый ответ по результатам.';

function buildSynthPrompt(goal: string, results: SubtaskResult[]): string {
  const parts = results
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r) => {
      const status = r.failed ? 'ПРОВАЛЕНА (результата нет)' : r.answer;
      return `Подзадача ${r.index + 1}: ${r.task}\nРезультат: ${status}`;
    });
  return (
    'Ты собирал ответ по частям. Ниже результаты подзадач. Собери из них ' +
    'ОДИН целостный ответ пользователю.\n' +
    'Правила: не выдумывай ничего сверх результатов; если подзадача ' +
    'провалена — честно скажи, какой части не хватает; не упоминай ' +
    'внутреннюю кухню (подзадачи, агентов) — просто ответь по существу.\n\n' +
    `Исходная цель: ${goal}\n\n${parts.join('\n\n')}\n\nИтоговый ответ:`
  );
}

// Тот же URL_RE, что в guards.ts (не экспортируется оттуда — локальная копия,
// логика G1-скраба должна остаться идентичной обычной петле).
const URL_RE = /https?:\/\/[^\s)\]>"'»]+/g;

function urlsOf(text: string): string[] {
  return [...(text || '').matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}

/**
 * Скраб непроверенных URL по СОВОКУПНОМУ evidence всех подзадач (референс:
 * Kora._scrub_answer, применённый к synth_out). URL в финальном тексте,
 * которого нет ни в объединённом evidence, ни в исходном вопросе
 * пользователя — считается выдумкой синтез-модели и вырезается.
 */
function scrubSynthesisUrls(text: string, combinedEvidence: string, userMsg: string): string {
  let out = text;
  for (const u of urlsOf(out)) {
    if (!combinedEvidence.includes(u) && !userMsg.includes(u)) {
      out = out.split(u).join('[ссылка удалена: не подтверждена источниками]');
    }
  }
  return out;
}

async function synthesize(
  goal: string,
  results: SubtaskResult[],
  generate: GenerateFn,
  signal: AbortSignal | undefined
): Promise<string> {
  const out = await generate(
    [
      { role: 'system', content: SYNTH_FALLBACK_SYSTEM_PROMPT },
      { role: 'user', content: buildSynthPrompt(goal, results) },
    ],
    { signal }
  );

  // Синтезированный ответ проходит ТЕ ЖЕ guardrails, что обычный: сначала
  // анти-фабрикация <result> и сырых тегов (sanitizeFinalAnswer уже включает
  // stripFakeResults внутри себя — вызываем один раз, второй вызов
  // stripFakeResults ниже избыточен, но безвреден и явно документирует
  // намерение "провести через тот же фильтр, что и обычная петля").
  let clean = sanitizeFinalAnswer(stripFakeResults(out));

  const combinedEvidence = results
    .map((r) => (r.turnState ? r.turnState.evidence : ''))
    .join('\n');
  if (combinedEvidence) {
    clean = scrubSynthesisUrls(clean, combinedEvidence, goal);
  }
  return clean;
}

// ─── Главная функция ────────────────────────────────────────────────────────

export interface RunOrchestratedOptions<TCtx = unknown> extends RunReactLoopOptions<TCtx> {
  /** Вызывается СРАЗУ по завершении каждой подзадачи (не ждёт остальных) —
   * живой граф прогресса в UI. */
  onSubtaskDone?: (index: number, result: SubtaskResult) => void;
}

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

/**
 * isComposite? нет → сразу runReactLoop (обычный путь, план-модель НЕ
 * вызывается). Да → планировщик; план не распарсился (< 2 пунктов) →
 * тихий откат на runReactLoop (штатный путь, не ошибка). Иначе → параллель
 * → синтез.
 */
export async function runOrchestrated<TCtx = unknown>(
  opts: RunOrchestratedOptions<TCtx>
): Promise<LoopResult> {
  const { userMsg, generate, signal, onEvent, registry, ctx } = opts;

  if (!isComposite(userMsg)) {
    return runReactLoop(opts);
  }

  const subtasks = await planSubtasks(userMsg, generate, signal);
  if (subtasks.length < 2) {
    return runReactLoop(opts);
  }

  const steps: LoopEvent[] = [];
  const emit = (evt: LoopEvent) => {
    steps.push(evt);
    onEvent?.(evt);
  };
  const forwardEvent = (evt: LoopEvent) => {
    steps.push(evt);
    onEvent?.(evt);
  };

  emit({
    type: 'step_start',
    step: 1,
    label: `Разбил на ${subtasks.length} подзадачи`,
    detail: subtasks.join('; '),
  });

  const results = await runSubtasksParallel(
    subtasks,
    registry,
    generate,
    ctx,
    signal,
    forwardEvent,
    opts.onSubtaskDone
  );

  emit({ type: 'step_start', step: subtasks.length + 1, label: 'Собираю итоговый ответ' });
  const answer = await synthesize(userMsg, results, generate, signal);
  emit({ type: 'final', step: subtasks.length + 2, detail: truncate(answer, 200) });

  // Совокупный TurnState — объединённый evidence всех подзадач (нужен, если
  // вызывающий код прогонит финальный ответ ещё через какой-то внешний
  // guardrail, опирающийся на turnState.evidence).
  const turnState = new TurnState(userMsg);
  for (const r of results) {
    if (r.turnState) {
      for (const e of r.turnState.evidenceParts) turnState.addEvidence(e);
    }
  }

  return { answer, steps, turnState, stopReason: 'final' };
}
