// СЕРВИС — декларативный слой интеграций КОРЫ. См. docs/PORTING_TO_TS.md
// раздел 6 и kora/integrations.py (IntegrationRegistry) как построчный
// референс. Интеграция = манифест (здесь: типизированная TS-константа,
// см. src/kora/manifests/telegram.ts), не код — один универсальный
// исполнитель на все сервисы разом.
//
// Правила исполнителя (ТЗ раздел 6, дословно):
//  1. секрет — только ИМЯ в манифесте ("credential": "telegram_bot_token"),
//     значение приходит из credentialResolver (per-user хранилище), никогда
//     не попадает в манифест и никогда не в контекст модели;
//  2. таймаут ~30с на HTTP-вызов;
//  3. retry с паузой — ТОЛЬКО read-действия (write: false), и только на
//     сетевые ошибки/5xx/429 (write без idempotency-ключа НЕ ретраить —
//     письмо уедет дважды);
//  4. тело ошибки усечено (~500 симв) — модели нужен статус и суть, не
//     мегабайт HTML от прокси;
//  5. секрет вычищается из текста ЛЮБОЙ ошибки перед возвратом (сетевые
//     исключения иногда вшивают URL целиком, включая токен из
//     token_in_url-авторизации) — заменяется на '•••';
//  6. в исходящий запрос уходят ТОЛЬКО объявленные в манифесте поля
//     (required+optional+params) — лишнее из аргументов модели отсекается.

import type { ToolDef } from './registry.js';

// ─── Типы манифеста (формат сверен с integrations/*.json референса) ────────

export type AuthType = 'token_in_url' | 'bearer' | 'header' | 'none';

export interface ServiceAuth {
  type: AuthType;
  /** Имя креденшела во внешнем хранилище — значение НИКОГДА не хранится
   * здесь. Не нужен при type: 'none'. */
  credential?: string;
  /** Имя заголовка для auth.type === 'header' (дефолт 'X-Api-Key'). */
  header?: string;
}

/** Мини-JSON-схема одного параметра действия (упрощённый MCP inputSchema).
 * Валидируется ДО HTTP-вызова. */
export interface ServiceParamSpec {
  type?: 'string' | 'integer' | 'boolean';
  enum?: unknown[];
  description?: string;
}

export interface ServiceAction {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  required: string[];
  optional?: string[];
  params?: Record<string, ServiceParamSpec>;
  write: boolean;
  description?: string;
}

export interface ServiceManifest {
  name: string;
  description?: string;
  base_url: string;
  auth: ServiceAuth;
  actions: Record<string, ServiceAction>;
}

export interface ServiceListEntry {
  service: string;
  description: string;
  actions: Record<string, { description: string; required?: string[] }>;
}

export interface ServiceCallResult {
  error?: string;
  [key: string]: unknown;
}

export interface ServiceCallContext {
  userId?: string;
}

/** Резолвер креденшела по имени — per-user хранилище продукта (env/БД).
 * Отсутствие секрета — это { null }, не исключение (пользователь ещё не
 * подключил интеграцию — актуальная ошибка, не баг). */
export type CredentialResolver = (name: string, ctx?: ServiceCallContext) => Promise<string | null>;

const DEFAULT_TIMEOUT_MS = 30_000;
const ERROR_TRUNCATE_LEN = 500;

// сеть/таймаут/5xx/429 — повтор имеет смысл. 4xx (кроме 429) не ретраим:
// повтор того же запроса даст ту же ошибку (kora/integrations.py::_retryable).
const RETRYABLE_MARKS = ['HTTP 5', 'HTTP 429', 'AbortError', 'timed out', 'TimeoutError', 'ECONNRESET', 'ECONNREFUSED', 'FetchError', 'TypeError: fetch failed'];

function isRetryable(error: string | undefined | null): boolean {
  if (!error) return false;
  return RETRYABLE_MARKS.some((m) => error.includes(m));
}

/** Убирает секрет из ЛЮБОГО текста ошибки перед возвратом наружу — сетевые
 * исключения иногда вшивают URL целиком, включая токен token_in_url. */
function scrubSecret(text: string, secret: string | null): string {
  if (!secret) return text;
  return text.split(secret).join('•••');
}

function truncateError(text: string): string {
  return text.length > ERROR_TRUNCATE_LEN ? text.slice(0, ERROR_TRUNCATE_LEN) : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function httpTransport(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  payload: Record<string, unknown> | null,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ServiceCallResult> {
  let finalUrl = url;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };

  if (payload && method === 'GET') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      params.set(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
    }
    const qs = params.toString();
    if (qs) finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs;
  } else if (payload !== null) {
    init.body = JSON.stringify(payload);
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(fetchImpl, finalUrl, init, timeoutMs);
  } catch (exc: any) {
    return { error: `${exc?.name || 'Error'}: ${exc?.message || exc}` };
  }

  if (!resp.ok) {
    let detail = '';
    try {
      detail = truncateError(await resp.text());
    } catch {
      /* тело недоступно — детали не будет, статус всё равно вернём */
    }
    return { error: `HTTP ${resp.status}: ${detail}` };
  }

  const bodyText = await resp.text();
  try {
    return JSON.parse(bodyText);
  } catch {
    return { text: bodyText.slice(0, 2000) };
  }
}

function validateParams(params: Record<string, ServiceParamSpec>, args: Record<string, unknown>): string | null {
  for (const [name, spec] of Object.entries(params)) {
    if (!(name in args)) continue;
    const val = args[name];
    if (spec.enum && !spec.enum.includes(val)) {
      return `поле '${name}': значение ${JSON.stringify(val)} не из допустимых ${JSON.stringify(spec.enum)}`;
    }
    if (spec.type === 'integer' && !Number.isInteger(val)) {
      const n = Number(val);
      if (Number.isNaN(n)) return `поле '${name}' должно быть целым числом`;
      args[name] = Math.trunc(n);
    } else if (spec.type === 'boolean' && typeof val !== 'boolean') {
      const s = String(val).toLowerCase();
      if (['true', '1', 'да'].includes(s)) args[name] = true;
      else if (['false', '0', 'нет'].includes(s)) args[name] = false;
      else return `поле '${name}' должно быть true/false`;
    } else if (spec.type === 'string' && typeof val !== 'string') {
      args[name] = String(val);
    }
  }
  return null;
}

export class ServiceExecutor {
  private readonly manifests: Map<string, ServiceManifest>;
  private readonly resolveCredential: CredentialResolver;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    manifests: ServiceManifest[],
    credentialResolver: CredentialResolver,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.manifests = new Map(manifests.map((m) => [m.name, m]));
    this.resolveCredential = credentialResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** Каталог для модели: имя+описание+действия, БЕЗ секретов, БЕЗ полной
   * params-схемы (kora/integrations.py::list). */
  list(): ServiceListEntry[] {
    const out: ServiceListEntry[] = [];
    for (const m of this.manifests.values()) {
      const actions: ServiceListEntry['actions'] = {};
      for (const [name, spec] of Object.entries(m.actions)) {
        const row: { description: string; required?: string[] } = { description: spec.description || '' };
        if (spec.required.length > 0) row.required = spec.required;
        actions[name] = row;
      }
      out.push({ service: m.name, description: m.description || '', actions });
    }
    return out;
  }

  getAction(service: string, action: string): ServiceAction | undefined {
    return this.manifests.get(service)?.actions[action];
  }

  isWrite(service: string, action: string): boolean {
    return Boolean(this.getAction(service, action)?.write);
  }

  async call(
    service: string,
    action: string,
    args: Record<string, unknown>,
    ctx: ServiceCallContext = {},
  ): Promise<ServiceCallResult> {
    const manifest = this.manifests.get(service);
    if (!manifest) {
      const avail = Array.from(this.manifests.keys()).join(', ') || 'нет сервисов';
      return { error: `сервис '${service}' не найден. Доступны: ${avail}` };
    }
    const spec = manifest.actions[action];
    if (!spec) {
      const avail = Object.keys(manifest.actions).join(', ');
      return { error: `у сервиса '${service}' нет действия '${action}'. Доступны: ${avail}` };
    }

    const missing = spec.required.filter((p) => args[p] === undefined || args[p] === null || args[p] === '');
    if (missing.length > 0) {
      return {
        error:
          `не хватает обязательных полей: ${missing.join(', ')}. Формат: ` +
          `{"service": "${service}", "action": "${action}", "args": {"${missing[0]}": "..."}}`,
      };
    }

    const argsCopy: Record<string, unknown> = { ...args };
    const verr = validateParams(spec.params || {}, argsCopy);
    if (verr) return { error: verr };

    // авторизация: значение по имени из credentialResolver, никогда в контекст модели
    const auth = manifest.auth || { type: 'none' as AuthType };
    const headers: Record<string, string> = {};
    let baseUrl = manifest.base_url;
    let secret: string | null = null;
    if (auth.type !== 'none') {
      const credName = auth.credential || '';
      secret = await this.resolveCredential(credName, ctx);
      if (!secret) {
        return {
          error: `нет креденшела '${credName}' для сервиса '${service}' — подключи его в настройках. Действие не выполнено.`,
        };
      }
      if (auth.type === 'token_in_url') {
        baseUrl = baseUrl.replace('{token}', secret);
      } else if (auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${secret}`;
      } else if (auth.type === 'header') {
        headers[auth.header || 'X-Api-Key'] = secret;
      }
    }

    // только объявленные поля уходят в запрос — лишнее из args отсекается
    const allowed = new Set<string>([...spec.required, ...(spec.optional || []), ...Object.keys(spec.params || {})]);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(argsCopy)) {
      if (allowed.has(k)) payload[k] = v;
    }

    const url = baseUrl + spec.path;
    let result = await httpTransport(this.fetchImpl, spec.method, url, payload, headers, this.timeoutMs);

    // retry — только read-действия, только сеть/5xx/429; write НИКОГДА
    // (без idempotency-ключа повтор письма/сообщения уедет дважды)
    if (!spec.write && isRetryable(typeof result.error === 'string' ? result.error : null)) {
      await sleep(1000);
      result = await httpTransport(this.fetchImpl, spec.method, url, payload, headers, this.timeoutMs);
    }

    if (typeof result.error === 'string') {
      result.error = truncateError(scrubSecret(result.error, secret));
    }
    return result;
  }
}

/** Определяет, является ли конкретный вызов сервис.call write-действием —
 * ToolDef.isWrite статичен (одно поле на весь инструмент), а по факту
 * write-флаг зависит от service+action внутри args. Петля/HITL-гейт
 * должны использовать ЭТУ функцию поверх статичного isWrite инструмента,
 * когда решают, ставить ли конкретный вызов в очередь подтверждения. */
export function isWriteServiceAction(executor: ServiceExecutor, args: Record<string, unknown>): boolean {
  const service = String(args.service ?? '');
  const action = String(args.action ?? '');
  return executor.isWrite(service, action);
}

// ─── Фабрики ToolDef ────────────────────────────────────────────────────

/** 'сервис.list' — каталог сервисов и действий, без секретов и полной схемы. */
export function serviceListTool(executor: ServiceExecutor): ToolDef {
  return {
    name: 'сервис.list',
    description: 'Список доступных интеграций (сервисов) и их действий.',
    argsSchema: {},
    isWrite: false,
    execute: async () => executor.list(),
  };
}

/** 'сервис.call' — универсальный вызов действия манифест-интеграции.
 * isWrite: true статично для этого ToolDef — безопасный дефолт (петля не
 * знает заранее service/action без парсинга args); реальное решение о
 * гейте — через isWriteServiceAction(executor, args) выше. */
export function serviceCallTool(executor: ServiceExecutor): ToolDef {
  return {
    name: 'сервис.call',
    description: 'Вызвать действие интеграции: {"service": "...", "action": "...", "args": {...}}.',
    argsSchema: {
      service: { type: 'string', required: true, description: 'имя сервиса' },
      action: { type: 'string', required: true, description: 'имя действия' },
      args: { type: 'object', required: false, description: 'аргументы действия' },
    },
    isWrite: true,
    execute: async (callArgs, ctx) => {
      const service = String(callArgs.service ?? '');
      const action = String(callArgs.action ?? '');
      const innerArgs = (callArgs.args as Record<string, unknown>) || {};
      return executor.call(service, action, innerArgs, (ctx as ServiceCallContext) || {});
    },
  };
}
