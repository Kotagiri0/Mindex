// Guardrails 1-6 агентного харнесса КОРА. См. docs/PORTING_TO_TS.md раздел 2
// (таблица) — порядок в таблице важен, первое совпадение решает. G1-G2
// применяются к сырому тексту модели (не к вызову), G3-G6 — пре-колл проверки
// перед реальным вызовом инструмента, объединены в runPreCallGuards.
//
// Ссылки на живой Python-референс: kora/orchestrator.py — _strip_fake_results,
// _final_answer, _remember_guard, дедуп/бюджет в run().

import type { ParsedAction } from './types.js';
import { TurnState, TOOL_BUDGET, BUDGET_DEFAULT, callKey } from './turn-state.js';

// ─── G1 — Анти-фабрикация <result> ────────────────────────────────────────
// Живой баг (exp_03 A1): модель дописывает в СВОЙ вывод поддельный
// <result tool="...">{...выдумка...}</result> и отвечает по нему, будто
// инструмент уже вызван. Единственный источник настоящего <result> —
// оркестратор, вставляющий его отдельным сообщением. Чинится в двух точках:
// обрезкой контекста по концу последнего action и вырезанием <result> из
// любого текста модели перед показом.

const ACTION_RE = /<action\s+tool=['"]([^'"]+)['"]\s*>([\s\S]*?)<\/action>/g;
const TOOL_WORD = "[\\w\\p{L}]+\\.[\\w\\p{L}]+";
const BODY_ACTION_RE = new RegExp(`<(${TOOL_WORD})>\\s*(\\{[\\s\\S]*?\\})\\s*</\\1>`, 'gu');
const TRUNCATED_ACTION_RE = /<action\s+tool=['"]([^'"]+)['"]\s*>((?!<\/action>)[\s\S])*$/;

const RESULT_TAG_RE = /<result\b[^>]*>[\s\S]*?<\/result>/g;

/**
 * Обрезает вывод модели по концу ПОСЛЕДНЕГО распознанного <action> (любой
 * из трёх форматов парсера — раздел 1.1 ТЗ) перед тем, как класть текст в
 * историю диалога. Всё, что модель дописала ПОСЛЕ настоящего action
 * (в т.ч. фейковые <result>), в контекст следующего шага не попадает.
 * Если ни одного action не найдено — текст не трогаем (нечего обрезать,
 * это финальный ответ без действий).
 */
export function truncateAtLastAction(modelOutput: string): string {
  let lastEnd = -1;

  for (const m of modelOutput.matchAll(ACTION_RE)) {
    const end = m.index! + m[0].length;
    if (end > lastEnd) lastEnd = end;
  }
  for (const m of modelOutput.matchAll(BODY_ACTION_RE)) {
    const end = m.index! + m[0].length;
    if (end > lastEnd) lastEnd = end;
  }
  // Оборванный хвост в самом конце текста — тоже action, обрезать нечего
  // (он и так последний символ строки), но если он идёт ПОСЛЕ уже найденного
  // закрытого action, оборванный кусок и есть новый "конец".
  const tm = TRUNCATED_ACTION_RE.exec(modelOutput);
  if (tm && tm.index! + tm[0].length > lastEnd) {
    lastEnd = modelOutput.length; // оборванный хвост тянется до конца строки
  }

  if (lastEnd === -1) return modelOutput;
  return modelOutput.slice(0, lastEnd);
}

/**
 * Вырезает все <result>...</result> из текста МОДЕЛИ. Настоящий <result>
 * вставляет только оркестратор отдельным сообщением — если он встретился в
 * тексте самой модели, это фабрикация, вырезание безопасно всегда.
 */
export function stripFakeResults(text: string): string {
  return text.replace(RESULT_TAG_RE, '');
}

// ─── G2 — Сырые теги не показываются пользователю ─────────────────────────
// Живой баг: оборванный/непарсенный <action> вываливался в чат как «ответ» —
// пользователь видел внутреннюю механику петли вместо текста.

const ANSWER_TAG_RE = /<answer>([\s\S]*?)<\/answer>/;
// закрытый ИЛИ оборванный (до конца строки) <action>-тег
const ANY_ACTION_TAG_RE = /<action\b[\s\S]*?(?:<\/action>|$)/g;

const FALLBACK_ANSWER =
  'Не получилось выполнить действие: ответ ядра оборвался на середине. ' +
  'Попробуй ещё раз или переформулируй короче.';

/**
 * Финальный фильтр перед показом ответа пользователю. Извлекает <answer>,
 * если модель им обернула текст; иначе берёт текст как есть. Сырые
 * <action>-теги (закрытые и оборванные) вырезаются ВСЕГДА — это внутренняя
 * механика петли, не ответ. Пустой результат после вырезания заменяется
 * честной заглушкой, а не пустой строкой.
 */
export function sanitizeFinalAnswer(text: string): string {
  const m = ANSWER_TAG_RE.exec(text);
  let out = (m ? m[1] : text).trim();
  // Фейковые <result> вырезаются из финального текста ВСЕГДА (G1: «из ЛЮБОГО
  // текста модели перед показом») — иначе фабрикация, вставленная моделью в
  // сам финальный ответ, уходит пользователю сырыми тегами.
  out = stripFakeResults(out).trim();
  if (out.includes('<action')) {
    out = out.replace(ANY_ACTION_TAG_RE, '').trim();
  }
  if (!out) out = FALLBACK_ANSWER;
  return out;
}

// ─── G3-G6 — пре-колл guardrails ───────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)\]>"'»]+/g;

function urlsOf(text: string): string[] {
  return [...(text || '').matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}

const REMEMBER_WORDS = ['запомн', 'сохрани', 'запиши', 'remember'];

/**
 * G3 — Дедуп вызовов. Живой баг: модель повторяет тот же вызов до
 * исчерпания лимита шагов. Ключ = канон.имя + JSON отсортированных args —
 * транслит-варианты одного вызова (relsa.search / рельса.search) с теми же
 * аргументами считаются ОДНИМ вызовом, потому что канонизация уже привела
 * их к общему имени.
 */
export function checkDuplicate(state: TurnState, action: ParsedAction): string | null {
  const key = callKey(action.tool, action.args);
  if (state.seenCalls.has(key)) {
    return (
      'этот инструмент с этими аргументами уже вызывался — результат выше ' +
      'в диалоге. НЕ повторяй вызов. Ответь по уже полученным данным в <answer>.'
    );
  }
  return null;
}

/**
 * G4 — Бюджет вызовов на инструмент за ход. Живой баг (exp_03): модель
 * сделала 25 поисков подряд за один ход. Лимиты — из TOOL_BUDGET (взяты из
 * kora/orchestrator.py::_TOOL_BUDGET), дефолт 5 для необъявленных инструментов.
 */
export function checkBudget(state: TurnState, action: ParsedAction): string | null {
  const used = state.usedBudget.get(action.tool) ?? 0;
  const limit = TOOL_BUDGET[action.tool] ?? BUDGET_DEFAULT;
  if (used >= limit) {
    return (
      `лимит вызовов ${action.tool} за один ход исчерпан. Больше не вызывай ` +
      'инструменты — сформулируй финальный <answer> по имеющимся данным; ' +
      'если их нет — честно скажи, что не нашёл.'
    );
  }
  return null;
}

/** Достаёт из args полисад.remember значение факта: value/text/fact —
 * первое из непустых, как в Python-референсе. */
function rememberValue(args: Record<string, unknown>): string {
  const v = args.value ?? args.text ?? args.fact;
  return v == null ? '' : String(v);
}

/**
 * G5 — Remember-guard. Живой баг: модель сохраняла в долгую память
 * ВЫДУМАННЫЕ факты/URL, не встречавшиеся в реальных результатах
 * инструментов. Блокирует запись, если:
 * (а) в значении есть URL, которого нет ни в evidence-буфере, ни в словах
 *     пользователя;
 * (б) факт вообще ничем не подтверждён — evidence пуст и пользователь явно
 *     не просил «запомни».
 */
export function checkRememberGuard(state: TurnState, action: ParsedAction): string | null {
  if (action.tool !== 'полисад.remember') return null;

  const value = rememberValue(action.args);
  const evidence = state.evidence;
  const fabricated = urlsOf(value).filter(
    (u) => !evidence.includes(u) && !state.userMsg.includes(u)
  );
  if (fabricated.length > 0) {
    return (
      `ЗАБЛОКИРОВАНО: ссылка ${fabricated[0]} не встречалась ни в одном ` +
      '<result> — это выдумка. В память сохраняются только проверенные ' +
      'данные. Если поиск ничего не дал — честно скажи об этом в <answer>, ' +
      'ничего не сохраняя.'
    );
  }

  const userAsked = REMEMBER_WORDS.some((w) => state.userMsg.toLowerCase().includes(w));
  if (!evidence && !userAsked) {
    return (
      'ЗАБЛОКИРОВАНО: этот факт не подтверждён ни результатами инструментов, ' +
      'ни словами пользователя. Не сохраняй предположения в память. Ответь ' +
      'пользователю честно в <answer>.'
    );
  }
  return null;
}

/**
 * G6 — Write-payload guard. Тот же класс бага, что remember-guard, но для
 * write-действий во внешние сервисы: расхождение показанного пользователю
 * вопроса подтверждения и реально отправленного payload — критичный баг
 * безопасности (скраб чистил URL из показа, но по «да» уходил оригинал с
 * выдумкой). Проверка идёт ДО постановки в очередь подтверждения — не после.
 */
export function checkWritePayloadGuard(
  state: TurnState,
  action: ParsedAction,
  isWriteAction: boolean
): string | null {
  if (!isWriteAction) return null;

  const payloadJson = JSON.stringify(action.args);
  const evidence = state.evidence;
  const fabricated = urlsOf(payloadJson).filter(
    (u) => !evidence.includes(u) && !state.userMsg.includes(u)
  );
  if (fabricated.length > 0) {
    return (
      `ЗАБЛОКИРОВАНО: ссылка ${fabricated[0]} в отправляемых данных не ` +
      'встречалась ни в одном <result> и ни в сообщении пользователя — это ' +
      'выдумка. Write-действия с непроверенными данными наружу не уходят.'
    );
  }
  return null;
}

export interface PreCallGuardResult {
  allowed: boolean;
  blockMessage?: string;
}

/**
 * Единая пре-колл проверка. Прогоняет G3→G4→G5→G6 в порядке таблицы раздела
 * 2 ТЗ — первое совпадение решает, дальше не проверяем. Вызывающий код сам
 * решает, что делать с allowed=false (не тратить бюджет, не исполнять
 * инструмент, положить blockMessage в <result> вместо реального ответа) и
 * сам, ПОСЛЕ allowed=true, вызывает state.recordCall(...).
 */
export function runPreCallGuards(
  state: TurnState,
  action: ParsedAction,
  opts: { isWriteAction?: boolean } = {}
): PreCallGuardResult {
  const dupBlock = checkDuplicate(state, action);
  if (dupBlock) return { allowed: false, blockMessage: dupBlock };

  const budgetBlock = checkBudget(state, action);
  if (budgetBlock) return { allowed: false, blockMessage: budgetBlock };

  const rememberBlock = checkRememberGuard(state, action);
  if (rememberBlock) return { allowed: false, blockMessage: rememberBlock };

  const writeBlock = checkWritePayloadGuard(state, action, opts.isWriteAction ?? false);
  if (writeBlock) return { allowed: false, blockMessage: writeBlock };

  return { allowed: true };
}
