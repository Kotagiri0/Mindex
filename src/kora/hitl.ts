// HITL-гейт подтверждения write-действий. См. docs/PORTING_TO_TS.md раздел 5
// (8 пунктов механики) и kora/orchestrator.py — _CONFIRM_YES_RE/_CONFIRM_NO_RE,
// _perm_verdict/_perm_match, Kora._pending/_audit, пре-пасс гейта в _react_loop
// (строки ~734-819) как построчный референс.
//
// СЕРВЕРНАЯ АДАПТАЦИЯ (главное отличие от Python): там pending жил в памяти
// одного процесса ("Kora._pending: dict") — переживает один процесс, не
// переживает рестарт (известная проблема из HANDOFF). Прод — Docker на VPS,
// рестарты и потенциально несколько инстансов. Поэтому pending и аудит-лог
// здесь — ИНТЕРФЕЙСЫ (async), а не прямые структуры данных; конкретная
// Postgres-имплементация — отдельная фаза интеграции в server.ts (нет доступа
// к схеме БД в этой фазе, здесь только InMemory-имплементации для тестов/дефолта).

import { stripSpecialTokens } from './sanitize.js';

// ─── Типы ───────────────────────────────────────────────────────────────

/** Одно отложенное write-действие внутри pending-группы. describe — текст,
 * который увидит пользователь в вопросе подтверждения; рендерится КОДОМ
 * (см. renderConfirmQuestion), не пересказом модели (п.2 раздела 5 ТЗ). */
export interface QueuedWriteAction {
  tool: string;
  args: Record<string, unknown>;
  describe: string;
}

/** Группа write-действий одного шага, ждущая ОДНОГО ответа пользователя
 * (п.3 раздела 5: несколько write-действий в шаге → один pending, один
 * вопрос — живой баг: второе действие молча терялось при обработке по одному). */
export interface PendingAction {
  id: string;
  userId: string;
  threadId: string;
  createdAt: number;
  actions: QueuedWriteAction[];
}

/** Хранилище pending-действий. Интерфейс, не конкретная БД — прод на Docker
 * с рестартами и потенциально несколькими инстансами, in-memory Map живой
 * баг с потерей pending при рестарте (см. HANDOFF референса) не решает. */
export interface PendingStore {
  put(pending: PendingAction): Promise<void>;
  /** Привязка строго по (userId, threadId) — живой баг: «да» в другом
   * треде подтверждало чужое действие. */
  getActive(userId: string, threadId: string): Promise<PendingAction | null>;
  delete(id: string): Promise<void>;
}

export type GateAuditKind =
  | 'queued'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'auto_allowed'
  | 'denied_by_policy';

export interface GateAuditEvent {
  ts: number;
  userId: string;
  threadId: string;
  kind: GateAuditKind;
  payload?: unknown;
  rule?: string;
}

/** Append-only аудит-лог событий гейта (п.8 раздела 5 ТЗ) — включая
 * отклонённые и протухшие, это самый ценный сигнал для регрессий и
 * построения allow-листов. */
export interface GateAuditLog {
  append(event: GateAuditEvent): Promise<void>;
}

/** Правило permissions вида "сервис:действие", "сервис:*" или
 * "сервис:действие(арг=знач)" — формат из kora/orchestrator.py::_perm_match. */
export type PermissionRule = string;

export interface PermissionRules {
  deny?: PermissionRule[];
  allow?: PermissionRule[];
}

// ─── In-memory имплементации (дефолт + тесты) ──────────────────────────

export class InMemoryPendingStore implements PendingStore {
  private readonly byKey = new Map<string, PendingAction>();

  private key(userId: string, threadId: string): string {
    return `${userId}::${threadId}`;
  }

  async put(pending: PendingAction): Promise<void> {
    this.byKey.set(this.key(pending.userId, pending.threadId), pending);
  }

  async getActive(userId: string, threadId: string): Promise<PendingAction | null> {
    return this.byKey.get(this.key(userId, threadId)) ?? null;
  }

  async delete(id: string): Promise<void> {
    for (const [k, v] of this.byKey) {
      if (v.id === id) this.byKey.delete(k);
    }
  }
}

export class InMemoryGateAuditLog implements GateAuditLog {
  readonly events: GateAuditEvent[] = [];

  async append(event: GateAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

// ─── п.6 — TTL ──────────────────────────────────────────────────────────

/** 15 минут — «да» спустя час не согласие на забытое действие
 * (kora/orchestrator.py::_PENDING_TTL_S). */
export const PENDING_TTL_MS = 15 * 60 * 1000;

export function isExpired(pending: PendingAction, now: number): boolean {
  return now - pending.createdAt > PENDING_TTL_MS;
}

// ─── п.2/п.12 — рендер вопроса подтверждения ───────────────────────────

/**
 * Точный payload рендерится КОДОМ из pending-объекта — JSON.stringify args
 * как есть, НЕ пересказом модели (approval-view fidelity: пересказ может
 * «прилизать» инъецированную часть payload). Показанное byte-in-byte
 * совпадает с тем, что уйдёт по подтверждению. stripSpecialTokens (G12)
 * применяется к итоговому тексту — payload может нести спецтокены из
 * скрейпленного/выдуманного контента модели.
 */
export function renderConfirmQuestion(pending: PendingAction): string {
  const lines = pending.actions.map((a) => `  ${a.describe}`).join('\n');
  const word =
    pending.actions.length === 1
      ? 'действие во внешнем сервисе'
      : `${pending.actions.length} действия во внешних сервисах`;
  const text = `Собираюсь выполнить ${word}:\n${lines}\nПодтвердить? (да / нет)`;
  return stripSpecialTokens(text);
}

/** Рендерит describe одного write-действия из tool+args кодом (не моделью).
 * args сериализуются как есть — byte-in-byte с тем, что уйдёт в execute(). */
export function describeAction(tool: string, args: Record<string, unknown>): string {
  let payload = JSON.stringify(args);
  if (payload.length > 700) payload = payload.slice(0, 700) + '…[обрезано]';
  return stripSpecialTokens(`${tool} ${payload}`);
}

// ─── п.5 — разбор ответа пользователя ──────────────────────────────────

// Слова сверены с kora/orchestrator.py::_CONFIRM_YES_RE/_CONFIRM_NO_RE —
// строгий якорный regex (^...$), а не includes: «да, но…» не должно
// случайно матчиться как согласие (в референсе тоже строгий match).
//
// Отличие от Python: там \W* после ключевого слова достаточно (Python \w
// unicode-aware, кириллица — «словные» символы, поэтому «да, но подожди»
// НЕ матчится — \W* не может «съесть» буквы «но подожди»). В JS \w — ASCII-
// only, кириллица для него \W, и наивный перенос того же \W* стал бы ловить
// «да, но подожди» как согласие (буквы «но подожди» ошибочно проходят как
// «не-словные»). Поэтому в порту хвост сознательно сужен до пунктуации и
// пробелов — не любой \W.
const CONFIRM_YES_RE =
  /^\s*(да|давай|подтверждаю|подтвердить|ок|окей|ага|угу|yes|ok|го|отправляй|шли|делай)[\s.,!?;:]*$/i;
const CONFIRM_NO_RE = /^\s*(нет|не надо|отмена|отменить|стоп|no|cancel)[\s.,!?;:]*$/i;

export type ConfirmVerdict = 'confirm' | 'reject' | 'other';

/**
 * Строгий regex на да/подтверждение → confirm; строгий на нет/отмену →
 * reject; ЛЮБОЙ другой ответ (в т.ч. смена темы) → 'other' — тоже сброс
 * pending, молча слать вдогонку по неявному согласию нельзя (п.5 раздела 5 ТЗ).
 */
export function resolveUserReply(reply: string): ConfirmVerdict {
  if (CONFIRM_YES_RE.test(reply)) return 'confirm';
  if (CONFIRM_NO_RE.test(reply)) return 'reject';
  return 'other';
}

// ─── п.7 — permissions ──────────────────────────────────────────────────

// Unicode-aware: имена сервисов/действий у нас кириллические
// ("сервис", "полисад"...) — ASCII-only \w (без /u) их бы не матчил.
const RULE_RE = /^([\p{L}\p{N}_-]+):([\p{L}\p{N}_*-]+)(?:\(([\p{L}\p{N}_]+)=([^)]*)\))?$/u;

function permMatch(rule: PermissionRule, service: string, action: string, inner: Record<string, unknown>): boolean {
  const m = RULE_RE.exec(rule.trim());
  if (!m) return false;
  const [, rSrv, rAct, rKey, rVal] = m;
  if (rSrv !== service || (rAct !== '*' && rAct !== action)) return false;
  if (rKey !== undefined) {
    return String(inner[rKey] ?? '') === rVal;
  }
  return true;
}

/**
 * deny → allow → ask; deny всегда сильнее более широкого allow, первое
 * совпадение в каждом списке решает (kora/orchestrator.py::_perm_verdict).
 * Разрешение без скоупа по аргументу — это разрешение на всё, что действие
 * умеет (та же семантика, что Claude Code permissions).
 */
export function evaluatePermission(
  rules: PermissionRules | undefined,
  service: string,
  action: string,
  args: Record<string, unknown> | undefined
): 'deny' | 'allow' | 'ask' {
  const inner = args ?? {};
  for (const rule of rules?.deny ?? []) {
    if (permMatch(rule, service, action, inner)) return 'deny';
  }
  for (const rule of rules?.allow ?? []) {
    if (permMatch(rule, service, action, inner)) return 'allow';
  }
  return 'ask';
}

// ─── п.1/п.4 — пре-пасс: разбор действий шага на write/read ────────────

/** Обобщённая форма действия шага — loop.ts передаёт ParsedAction, тесты
 * могут передавать минимальный объект с этими полями. */
export interface WriteSplittable {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Разбивает действия ОДНОГО шага на write/read ДО исполнения любого из них
 * (п.4 раздела 5 ТЗ: гейт проверяется пре-пассом по всем действиям шага —
 * живой баг: если сначала исполнить read, а потом упереться в гейт,
 * результат read терялся при досрочном возврате).
 */
export function splitWriteActions<T extends WriteSplittable>(
  actions: T[],
  isWrite: (action: T) => boolean
): { writes: T[]; reads: T[] } {
  const writes: T[] = [];
  const reads: T[] = [];
  for (const a of actions) {
    (isWrite(a) ? writes : reads).push(a);
  }
  return { writes, reads };
}

// ─── Постановка в pending / подтверждение / отклонение ─────────────────

let counter = 0;
function newPendingId(): string {
  counter += 1;
  return `pending_${Date.now()}_${counter}`;
}

/** Кладёт ВСЕ переданные write-действия в ОДИН pending (п.3 раздела 5 ТЗ)
 * и пишет аудит-событие 'queued'. */
export async function queuePending(
  store: PendingStore,
  audit: GateAuditLog,
  userId: string,
  threadId: string,
  actions: QueuedWriteAction[],
  now: number
): Promise<PendingAction> {
  const pending: PendingAction = {
    id: newPendingId(),
    userId,
    threadId,
    createdAt: now,
    actions,
  };
  await store.put(pending);
  await audit.append({
    ts: now,
    userId,
    threadId,
    kind: 'queued',
    payload: actions.map((a) => a.describe),
  });
  return pending;
}

/**
 * Достаёт активный pending для (userId, threadId), проверяет TTL (п.6).
 * Протухший pending при ЛЮБОМ обращении удаляется + аудит 'expired', и
 * функция возвращает null (как если бы pending не было).
 */
async function fetchActivePending(
  store: PendingStore,
  audit: GateAuditLog,
  userId: string,
  threadId: string,
  now: number
): Promise<PendingAction | null> {
  const pending = await store.getActive(userId, threadId);
  if (!pending) return null;
  if (isExpired(pending, now)) {
    await store.delete(pending.id);
    await audit.append({
      ts: now,
      userId,
      threadId,
      kind: 'expired',
      payload: pending.actions.map((a) => a.describe),
    });
    return null;
  }
  return pending;
}

/**
 * «Да»: достаёт активный pending (с проверкой TTL), удаляет его из store,
 * пишет аудит 'confirmed', возвращает pending для исполнения вызывающим
 * кодом (сама функция НЕ исполняет tool.execute — это ответственность
 * интеграции в server.ts, у гейта нет доступа к диспетчеру инструментов).
 * null — pending не было или протух.
 */
export async function confirmPending(
  store: PendingStore,
  audit: GateAuditLog,
  userId: string,
  threadId: string,
  now: number
): Promise<PendingAction | null> {
  const pending = await fetchActivePending(store, audit, userId, threadId, now);
  if (!pending) return null;
  await store.delete(pending.id);
  await audit.append({
    ts: now,
    userId,
    threadId,
    kind: 'confirmed',
    payload: pending.actions.map((a) => a.describe),
  });
  return pending;
}

/**
 * «Нет» или любой другой ответ (п.5 — сброс тоже на 'other'): достаёт
 * активный pending, удаляет его, пишет аудит 'rejected'. null — pending не
 * было или протух (уже обработано аудитом 'expired' внутри fetch).
 */
export async function rejectPending(
  store: PendingStore,
  audit: GateAuditLog,
  userId: string,
  threadId: string,
  now: number
): Promise<PendingAction | null> {
  const pending = await fetchActivePending(store, audit, userId, threadId, now);
  if (!pending) return null;
  await store.delete(pending.id);
  await audit.append({
    ts: now,
    userId,
    threadId,
    kind: 'rejected',
    payload: pending.actions.map((a) => a.describe),
  });
  return pending;
}
