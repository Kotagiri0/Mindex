// ReAct-петля — сердце харнесса КОРА. См. docs/PORTING_TO_TS.md раздел 2
// (guardrails 7-11) и kora/orchestrator.py::Kora._react_loop как референс
// по построчной логике.
//
// Отличие от Python-референса (см. ТЗ, "ЦЕЛЕВОЙ СТЕК"): здесь петля НЕ
// хранит generate как метод объекта, а получает его инжекцией параметром
// (модель — за HTTP API, не локальный transformers-процесс). Петля ничего
// не знает о провайдере, express, БД — чистый модуль, всё состояние живёт
// в TurnState и локальных переменных одного вызова (многопользовательский
// сервер, никакого общего мутируемого состояния между запросами).

import type { ChatMessage } from './compact.js';
import { compactMessageAt } from './compact.js';
import { stripSpecialTokens } from './sanitize.js';
import { parseActions } from './parse.js';
import {
  truncateAtLastAction,
  sanitizeFinalAnswer,
  runPreCallGuards,
  checkWritePayloadGuard,
} from './guards.js';
import { TurnState, callKey } from './turn-state.js';
import type { ToolRegistry } from './registry.js';
import { validateArgs } from './registry.js';
import type { ParsedAction } from './types.js';
import { buildSystemPrompt, type BuildSystemPromptOptions } from './prompt.js';
import {
  splitWriteActions,
  evaluatePermission,
  describeAction,
  queuePending,
  renderConfirmQuestion,
  type PendingStore,
  type GateAuditLog,
  type PermissionRules,
  type QueuedWriteAction,
} from './hitl.js';

export type { ChatMessage } from './compact.js';

/** Функция вызова модели — инжектируется вызывающим кодом (адаптер
 * RouterAI/Groq и т.п.). Петля о провайдере ничего не знает. */
export type GenerateFn = (
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal }
) => Promise<string>;

/** Событие одного шага петли — задел под живой граф (Фаза 7) и стриминг
 * статуса в UI (Фаза 8 в терминах ТЗ, "живой граф процесса"). Минимально
 * достаточный набор полей: какой шаг, что произошло, по какому инструменту,
 * короткая выжимка для отображения (не полный JSON — тот же принцип
 * компакции, что и в истории модели). */
export interface LoopEvent {
  type: 'step_start' | 'action' | 'result' | 'blocked' | 'final';
  /** Номер шага петли, начиная с 1. */
  step: number;
  /** Человекочитаемая подпись узла графа ("Думаю над ответом", "Вызываю рельса.search"). */
  label?: string;
  /** Канонический инструмент, если событие относится к конкретному действию. */
  tool?: string;
  /** Короткая выжимка (аргументы/результат/причина блокировки/текст ответа), усечённая. */
  detail?: string;
  /** Индекс подзадачи (с нуля), если событие пришло из параллельного
   * суб-агента оркестрации (Фаза 8, orchestrate.ts). Отсутствует у событий
   * обычной линейной петли. */
  subtask?: number;
}

export interface RunReactLoopOptions<TCtx = unknown> {
  userMsg: string;
  /** История диалога ДО текущего сообщения пользователя (уже без системного промпта). */
  history?: ChatMessage[];
  registry: ToolRegistry<TCtx>;
  generate: GenerateFn;
  /** Контекст, прокидываемый в execute() каждого инструмента как есть. */
  ctx: TCtx;
  maxSteps?: number;
  onEvent?: (evt: LoopEvent) => void;
  signal?: AbortSignal;
  /** Определяет, является ли действие write-действием (для G6 write-payload
   * guard). По умолчанию — берётся из ToolDef.isWrite зарегистрированного в
   * реестре инструмента. HITL-гейт подтверждения (раздел 5 ТЗ) в эту фазу
   * не входит — write-действие с чистым payload исполняется как обычное,
   * подтверждение у пользователя добавит Фаза 5. */
  isWriteAction?: (action: ParsedAction) => boolean;
  /** Прокидывается в buildSystemPrompt (персона/каталоги навыков-сервисов). */
  promptOptions?: Omit<BuildSystemPromptOptions<TCtx>, 'registry'>;
  /** HITL-гейт подтверждения write-действий (раздел 5 ТЗ, Фаза 5). Если не
   * передан — поведение петли ровно как раньше (обратная совместимость):
   * write-действия исполняются как обычные, без вопроса подтверждения. */
  hitl?: {
    store: PendingStore;
    audit: GateAuditLog;
    userId: string;
    threadId: string;
    permissions?: PermissionRules;
  };
}

export interface LoopResult {
  answer: string;
  steps: LoopEvent[];
  turnState: TurnState;
  /** 'confirm_required' — ход завершился write-гейтом, ответ = вопрос
   * подтверждения, а не обычный финальный ответ модели. Отсутствие поля
   * (undefined) эквивалентно обычному 'final' — обратная совместимость с
   * кодом, который ещё не знает про HITL-гейт. */
  stopReason?: 'final' | 'confirm_required';
}

const DEFAULT_MAX_STEPS = 5;

// ─── G8 — Freshness-дозапрос ────────────────────────────────────────────────
// Живой баг: вопрос про свежие данные (курс, новости, версия) — модель
// ответила из головы без единого вызова инструмента. \b в JS не работает с
// кириллицей (не считает кириллические буквы "словными" символами), поэтому
// нельзя просто скопировать регэксп референса — «курс» ловил бы «реКУРСию»
// без явной проверки левой границы. Решение: negative lookbehind на
// кириллицу/латиницу/цифру/подчёркивание слева от маркера — эквивалент \b
// именно там, где он нужен (только левая граница, как и в референсе: сами
// маркеры это префиксы слов вроде "последн", правая граница не проверяется
// умышленно, чтобы ловить "последние", "последних" и т.п.).
const FRESH_MARKERS =
  'новост|сейчас|сегодня|завтра|последн|свеж|актуальн|стоит|цена|курс|' +
  'погод|верси|вышел|вышла|вышло|релиз|в этом году|в этом месяце|на этой неделе';
const FRESH_RE = new RegExp(`(?<![a-zа-яё0-9_])(?:${FRESH_MARKERS})`, 'iu');

const REMEMBER_WORDS = ['запомн', 'сохрани', 'запиши', 'remember'];

/** G7/G9 — неудачный вызов инструмента: ошибка, пустая выдача (results==[]
 * или rows==[]), либо пустой text у scrape-подобных инструментов. Совпадает
 * по критерию с kora/orchestrator.py::_tool_failed — заблокированные вызовы
 * (result = {error: ...}) тоже считаются провалом, это закрывает и сценарий,
 * когда модель до лимита шагов долбит заблокированные вызовы. */
function toolFailed(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  if (r.error) return true;
  if (Array.isArray(r.results) && r.results.length === 0) return true;
  if (Array.isArray(r.rows) && r.rows.length === 0) return true;
  if ('text' in r && !r.text) return true;
  return false;
}

/** G8 — "вызов данных" в отличие от служебных (навык.*, *.list): для
 * freshness-дозапроса считаются только они. */
function isDataTool(canonTool: string): boolean {
  return !(canonTool.startsWith('навык.') || canonTool.endsWith('.list'));
}

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

/**
 * Основная ReAct-петля. Один вызов — один ход диалога. Guardrails 7-11
 * применяются в порядке, продиктованном разделом 2 ТЗ / построчной логикой
 * Python-референса — см. комментарии внутри цикла.
 */
export async function runReactLoop<TCtx = unknown>(
  opts: RunReactLoopOptions<TCtx>
): Promise<LoopResult> {
  const {
    userMsg,
    history = [],
    registry,
    generate,
    ctx,
    maxSteps = DEFAULT_MAX_STEPS,
    onEvent,
    signal,
    promptOptions,
  } = opts;
  const isWriteAction =
    opts.isWriteAction ?? ((action: ParsedAction) => registry.get(action.tool)?.isWrite ?? false);

  const state = new TurnState(userMsg);
  // Цель хода — «запомни X» (и это не вопрос): после первой удачной записи
  // финалим без возврата к модели — ядро склонно зацикливаться на повторных
  // remember (kora/orchestrator.py::remember_only).
  const rememberOnly =
    REMEMBER_WORDS.some((w) => userMsg.toLowerCase().includes(w)) && !userMsg.includes('?');
  const steps: LoopEvent[] = [];
  const emit = (evt: LoopEvent) => {
    steps.push(evt);
    onEvent?.(evt);
  };

  const systemPrompt = buildSystemPrompt({ registry, ...promptOptions });
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMsg },
  ];

  let prevResultsIdx: number | null = null;
  let nudged = false; // G8: дозапрос "свежий вопрос без поиска" — не более одного раза за ход
  let dataToolAttempted = false; // G8: хоть одна попытка вызова ДАННЫХ за весь ход

  const finalize = (answer: string, step: number): LoopResult => {
    emit({ type: 'final', step, detail: truncate(answer, 200) });
    return { answer, steps, turnState: state };
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) {
      // п.13 — прерывание: возвращаем честный частичный результат, не молчим.
      return finalize(
        'Прервано пользователем до завершения ответа.' +
          (state.evidenceParts.length ? ' Часть данных уже была получена, но ответ не собран.' : ''),
        step
      );
    }

    emit({
      type: 'step_start',
      step,
      label: step === 1 ? 'Думаю над ответом' : 'Продолжаю разбираться',
    });

    let out: string;
    try {
      out = await generate(messages, { signal });
    } catch (e) {
      if (signal?.aborted) {
        return finalize('Прервано пользователем во время генерации ответа.', step);
      }
      throw e;
    }

    let actions = parseActions(out);

    if (actions.length === 0) {
      // G8 — freshness: свежий вопрос + ноль вызовов ДАННЫХ за весь ход при
      // попытке финального ответа → один принудительный дозапрос, не более
      // одного раза за ход. навык.load/сервис.list не считаются данными.
      if (!nudged && !dataToolAttempted && step < maxSteps && FRESH_RE.test(userMsg)) {
        nudged = true;
        emit({
          type: 'blocked',
          step,
          label: 'Ответила без поиска — прошу проверить в вебе',
        });
        messages.push({ role: 'assistant', content: out });
        messages.push({
          role: 'user',
          content:
            'СТОП: вопрос про актуальные данные, а ты не вызвал ни одного инструмента — ' +
            'такой ответ будет выдумкой. Вызови поиск СЕЙЧАС: ' +
            '<action tool="рельса.search">{"query": "..."}</action>. Если поиск ничего ' +
            'не даст — честно скажи, что данных нет.',
        });
        continue;
      }

      // G1 (фабрикация) + G2 (сырые теги) — sanitizeFinalAnswer уже вырезает
      // и то, и другое перед показом пользователю.
      const answer = sanitizeFinalAnswer(out);
      return finalize(answer, step);
    }

    const resultsBlockParts: string[] = [];
    let stepHadFailure = false;

    // ─── HITL-гейт (раздел 5 ТЗ) — пре-пасс ДО исполнения любого действия
    // шага. deny → блок без исполнения; allow → исполняется как read (не
    // тратит подтверждение); ask → откладывается, ВСЕ ask-write шага в один
    // pending (п.3). Reads шага (и allow-writes) остаются в `actions` и
    // проходят обычный per-action цикл ниже — их результат НЕ теряется
    // (живой баг из ТЗ п.4: досрочный return до исполнения read).
    let gatedActions: QueuedWriteAction[] = [];
    if (opts.hitl && actions.length > 0) {
      const { writes, reads } = splitWriteActions(actions, isWriteAction);
      if (writes.length > 0) {
        const { store, audit, userId, threadId, permissions } = opts.hitl;
        const now = Date.now();
        const autoAllowed: ParsedAction[] = [];
        for (const w of writes) {
          const dot = w.tool.indexOf('.');
          const service = dot === -1 ? w.tool : w.tool.slice(0, dot);
          const actionName = dot === -1 ? '' : w.tool.slice(dot + 1);
          const verdict = evaluatePermission(permissions, service, actionName, w.args);
          if (verdict === 'deny') {
            await audit.append({
              ts: now,
              userId,
              threadId,
              kind: 'denied_by_policy',
              payload: { tool: w.tool, args: w.args },
            });
            emit({ type: 'blocked', step, tool: w.tool, detail: 'запрещено политикой' });
            resultsBlockParts.push(
              `<result tool="${w.rawTool}">${JSON.stringify({
                error: `ЗАПРЕЩЕНО политикой: ${w.tool} в deny-списке. Не повторяй вызов — сообщи пользователю, что действие запрещено настройками.`,
              })}</result>`
            );
            continue;
          }
          if (verdict === 'allow') {
            await audit.append({
              ts: now,
              userId,
              threadId,
              kind: 'auto_allowed',
              payload: { tool: w.tool, args: w.args },
            });
            autoAllowed.push(w);
            continue;
          }
          // G6 — write-payload guard ДО постановки в очередь подтверждения
          // (живой баг безопасности из ТЗ §5: выдуманный URL нельзя даже
          // ПОКАЗЫВАТЬ в вопросе «подтвердить?» — блок до очереди, не после).
          const g6 = checkWritePayloadGuard(state, w, true);
          if (g6) {
            emit({ type: 'blocked', step, tool: w.tool, detail: truncate(g6, 200) });
            resultsBlockParts.push(
              `<result tool="${w.rawTool}">${JSON.stringify({ error: g6 })}</result>`
            );
            continue;
          }
          gatedActions.push({ tool: w.tool, args: w.args, describe: describeAction(w.tool, w.args) });
        }
        actions = [...reads, ...autoAllowed];
      }
    }

    for (const action of actions) {
      emit({
        type: 'action',
        step,
        tool: action.tool,
        detail: truncate(JSON.stringify(action.args), 200),
      });

      if (isDataTool(action.tool)) dataToolAttempted = true;

      const def = registry.get(action.tool);
      let result: unknown;
      let blockMessage: string | null = null;

      if (!def) {
        blockMessage =
          `неизвестный инструмент "${action.tool}". Доступные инструменты: ` +
          registry
            .list()
            .map((d) => d.name)
            .join(', ');
      } else {
        const validated = validateArgs(def, action.args);
        if (validated.ok === false) {
          blockMessage = validated.error;
        } else {
          const validatedAction: ParsedAction = { ...action, args: validated.args };
          const guardResult = runPreCallGuards(state, validatedAction, {
            isWriteAction: isWriteAction(validatedAction),
          });
          if (!guardResult.allowed) {
            blockMessage = guardResult.blockMessage ?? 'заблокировано guardrail-ом';
          } else {
            const key = callKey(validatedAction.tool, validatedAction.args);
            state.recordCall(key, validatedAction.tool);
            try {
              result = await def.execute(validatedAction.args, ctx);
            } catch (e) {
              result = { error: `инструмент упал: ${e instanceof Error ? e.message : String(e)}` };
            }
          }
        }
      }

      if (blockMessage) {
        result = { error: blockMessage };
        emit({ type: 'blocked', step, tool: action.tool, detail: truncate(blockMessage, 200) });
      } else {
        emit({
          type: 'result',
          step,
          tool: action.tool,
          detail: truncate(JSON.stringify(result), 200),
        });
      }

      // G1/G5/G6 — evidence копится только для реально успешных, непустых
      // результатов (то же условие, что в Python: ok && !empty).
      const ok = !blockMessage && result !== null && typeof result === 'object' && !(result as Record<string, unknown>).error;
      const empty =
        result !== null &&
        typeof result === 'object' &&
        (((result as Record<string, unknown>).results as unknown[] | undefined)?.length === 0 ||
          ('text' in (result as Record<string, unknown>) && !(result as Record<string, unknown>).text));
      if (ok && !empty) {
        state.addEvidence(JSON.stringify(result));
      } else if (!blockMessage && empty && action.tool.startsWith('рельса.')) {
        // Пустая выдача поиска → инструкция честности ПРЯМО в <result>:
        // модели следуют контексту лучше, чем системному промпту
        // (kora/orchestrator.py, тот же текст).
        result = {
          ...(result as Record<string, unknown>),
          hint:
            'Пусто. Разрешена ОДНА повторная попытка другим запросом (шире ' +
            'или по-английски). Снова пусто — честно скажи в <answer>, что ' +
            'данных нет. Выдумывать ссылки, цены и даты ЗАПРЕЩЕНО.',
        };
      }

      // G7 — эскалация после серии провалов (проверяем СРАЗУ после каждого
      // действия, как в референсе, а не только в конце шага).
      if (toolFailed(result)) {
        state.consecutiveFailures += 1;
        stepHadFailure = true;
      } else {
        state.consecutiveFailures = 0;
      }

      // G11 — санитизация спецтокенов ДО того, как результат попадёт в
      // контекст модели (веб-контент может нести <|im_start|> и т.п.).
      const resultJson = stripSpecialTokens(JSON.stringify(result));
      resultsBlockParts.push(`<result tool="${action.rawTool}">${resultJson}</result>`);

      // Цель хода была «запомни» и запись удалась — финалим сразу, не давая
      // ядру шанса зациклиться на повторных remember (референс:
      // remember_finalize). Ответ короткий и честный: что именно записано.
      if (
        rememberOnly &&
        action.tool === 'полисад.remember' &&
        result !== null &&
        typeof result === 'object' &&
        (result as Record<string, unknown>).stored
      ) {
        const key = (result as Record<string, unknown>).key ?? 'факт';
        return finalize(`Записал: ${key}.`, step);
      }

      if (state.consecutiveFailures >= 3) {
        return finalize(
          'Не смог найти достоверные данные: инструменты трижды подряд вернули ' +
            'пустой результат или ошибку. Честный ответ: по этому вопросу у меня ' +
            'сейчас данных нет.',
          step
        );
      }
    }

    // HITL-гейт: reads (и allow-writes) этого шага уже исполнены выше —
    // ask-writes откладываем в один pending и завершаем ход вопросом
    // подтверждения (п.3-4 раздела 5 ТЗ). Ответ = renderConfirmQuestion,
    // не sanitizeFinalAnswer — это не ответ модели, а вопрос оркестратора.
    if (gatedActions.length > 0 && opts.hitl) {
      const { store, audit, userId, threadId } = opts.hitl;
      const pending = await queuePending(store, audit, userId, threadId, gatedActions, Date.now());
      const question = renderConfirmQuestion(pending);
      emit({ type: 'blocked', step, label: 'Жду подтверждения write-действия', detail: truncate(question, 200) });
      emit({ type: 'final', step, detail: truncate(question, 200) });
      return { answer: question, steps, turnState: state, stopReason: 'confirm_required' };
    }

    // G9 — reinject исходного вопроса после ошибки: маленькие/слабые модели
    // дрейфуют от задачи после ошибки инструмента.
    if (stepHadFailure) {
      resultsBlockParts.push(`<reminder>Исходный вопрос пользователя: ${userMsg}</reminder>`);
    }

    // G10 — компакция: результат ПРОШЛОГО шага сжимается перед тем, как мы
    // положим в контекст вывод текущего шага (следующий generate() увидит
    // прошлый шаг сжатым, а этот — полным).
    let nextMessages = messages;
    if (prevResultsIdx !== null) {
      nextMessages = compactMessageAt(messages, prevResultsIdx);
    }

    // G1 — обрезаем вывод модели по концу последнего распознанного <action>
    // перед тем, как класть его в историю: всё, что дописано после
    // (в т.ч. поддельные <result>), в контекст не попадает.
    const contextOut = truncateAtLastAction(out);
    nextMessages = nextMessages.slice();
    nextMessages.push({ role: 'assistant', content: contextOut });
    nextMessages.push({ role: 'user', content: resultsBlockParts.join('\n') });
    prevResultsIdx = nextMessages.length - 1;
    messages.length = 0;
    messages.push(...nextMessages);
  }

  // п.12 — лимит шагов исчерпан: честное сообщение, не молчание. Последняя
  // генерация уже без парсинга действий — что бы модель ни написала, это
  // прогоняется через тот же финальный фильтр.
  if (signal?.aborted) {
    return finalize('Прервано пользователем до завершения ответа.', maxSteps + 1);
  }
  let out: string;
  try {
    out = await generate(messages, { signal });
  } catch (e) {
    if (signal?.aborted) {
      return finalize('Прервано пользователем во время генерации ответа.', maxSteps + 1);
    }
    throw e;
  }
  const answer = sanitizeFinalAnswer(out);
  return finalize(answer, maxSteps + 1);
}
