// РЕЛЬСА — веб-поиск каскадом станций. См. docs/PORTING_TO_TS.md раздел 6
// (общая идея манифестов относится к services.ts, но правила исполнителя —
// таймаут/усечение/санитизация — общие) и relsa/core.py, relsa/stations.py
// как построчный референс алгоритма каскада.
//
// Живой баг (relsa/core.py: _try_station/_run_chain): DDG под нагрузкой
// мигает — пустые выдачи и обрывы соединения валили целые категории задач
// в бенчмарке. Решение — не полагаться на одну станцию: пробуем по цепочке,
// первая НЕПУСТАЯ выдача побеждает, ошибка/пустота прозрачно уходит на
// следующую станцию. Полный провал цепочки — не исключение, а { results: [] }
// (петля должна честно сказать «не нашёл», не упасть).
//
// Санитизация (G11, sanitize.ts): скрейпленный веб-текст — внешний контент,
// не контролируемый нами, может содержать chat-template спецтокены модели
// (инъекция). Обязательно прогоняется через stripSpecialTokens перед тем,
// как попасть в результат инструмента.

import type { ToolDef } from './registry.js';
import { stripSpecialTokens } from './sanitize.js';
import { assertPublicUrl, type LookupFn } from './url-guard.js';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface SearchPayload {
  station: string;
  query: string;
  results: SearchResult[];
  error?: string;
  stationsTried?: string[];
}

export interface ScrapePayload {
  url: string;
  title: string;
  text: string;
  error?: string;
}

/** Опции станций, инжектируемые снаружи (ключи/базовые URL опциональных
 * станций) — раздел «ЦЕЛЕВОЙ СТЕК»: никакого чтения process.env внутри
 * функции станции напрямую, чтобы тесты были детерминированы без env-мока. */
export interface RelsaOptions {
  braveApiKey?: string;
  searxngBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Таймаут одного HTTP-вызова на станцию, мс. relsa/core.py: 15.0с. */
  timeoutMs?: number;
  /** DNS-резолвер для SSRF-гарда scrape_url (инжектируется в тестах). */
  lookupImpl?: LookupFn;
}

const MAX_REDIRECT_HOPS = 5;

/** Фетч URL, заданного моделью, с SSRF-гардом на КАЖДОМ хопе. Редиректы
 * следуем вручную (redirect: 'manual') и перепроверяем Location — иначе
 * публичный URL, отвечающий 302 на 169.254.169.254, обошёл бы проверку. */
interface SafeFetchResult {
  response: Response | null;
  error: string | null;
}

async function safeFetchFollow(
  startUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  lookupImpl?: LookupFn,
): Promise<SafeFetchResult> {
  let current = startUrl;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const blocked = await assertPublicUrl(current, lookupImpl);
    if (blocked) return { response: null, error: `запрос заблокирован: ${blocked}` };
    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        resp = await fetchImpl(current, { headers: HEADERS, redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (exc: any) {
      return { response: null, error: `${exc?.name || 'Error'}: ${exc?.message || exc}` };
    }
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return { response: resp, error: null };
      try {
        current = new URL(loc, current).toString();
      } catch {
        return { response: null, error: 'некорректный Location в редиректе' };
      }
      continue;
    }
    return { response: resp, error: null };
  }
  return { response: null, error: 'слишком много редиректов' };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const SCRAPE_MAX_CHARS = 4000; // relsa/core.py::_SCRAPE_MAX_CHARS

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ru,en;q=0.9',
};

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers: { ...HEADERS, ...headers }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Разбор HTML-выдачи станций (регулярками — без cheerio) ────────────────

/** DDG прячет реальный URL в параметре uddg редиректа — достаём его
 * (relsa/stations.py::_ddg_decode). */
function ddgDecode(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DDG HTML-фронт: div.result / div.web-result → a.result__a + .result__snippet
 * (relsa/stations.py::_ddg_parse). Парсим блоками по регексу, т.к. без DOM. */
function parseDdgHtml(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  const blockRe = /<div[^>]+class="[^"]*\b(?:result|web-result)\b[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*\b(?:result|web-result)\b|$)/g;
  const blocks = html.match(blockRe) || [];
  for (const block of blocks) {
    const aMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!aMatch) continue;
    const title = stripTags(aMatch[2]);
    if (!title) continue;
    const url = ddgDecode(aMatch[1]);
    const snMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/);
    const snippet = snMatch ? stripTags(snMatch[1]) : '';
    out.push({ title, snippet, url });
    if (out.length >= limit) break;
  }
  return out;
}

/** lite.duckduckgo.com — запасной лёгкий фронт (relsa/stations.py::_ddg_lite_parse). */
function parseDdgLite(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  const linkRe = /<a[^>]+class="[^"]*result-link[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]+class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const title = stripTags(m[2]);
    if (title) links.push({ url: ddgDecode(m[1]), title });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html))) snippets.push(stripTags(m[1]));
  for (let i = 0; i < links.length && out.length < limit; i++) {
    out.push({ title: links[i].title, snippet: snippets[i] || '', url: links[i].url });
  }
  return out;
}

function parseBraveJson(text: string, limit: number): SearchResult[] {
  const data = JSON.parse(text);
  const results = data?.web?.results || [];
  return results.slice(0, limit).map((r: any) => ({
    title: r.title || '',
    snippet: r.description || '',
    url: r.url || '',
  }));
}

function parseSearxngJson(text: string, limit: number): SearchResult[] {
  const data = JSON.parse(text);
  const results = data?.results || [];
  return results.slice(0, limit).map((r: any) => ({
    title: r.title || '',
    snippet: r.content || '',
    url: r.url || '',
  }));
}

// ─── Станции ────────────────────────────────────────────────────────────

interface Station {
  name: string;
  buildUrl: (query: string) => string;
  parse: (body: string, limit: number) => SearchResult[];
  headers?: () => Record<string, string>;
}

function buildStations(opts: RelsaOptions): Station[] {
  const stations: Station[] = [];
  if (opts.searxngBaseUrl) {
    const base = opts.searxngBaseUrl.replace(/\/$/, '');
    stations.push({
      name: 'searxng',
      buildUrl: (q) => `${base}/search?q=${encodeURIComponent(q)}&format=json&language=ru`,
      parse: parseSearxngJson,
    });
  }
  if (opts.braveApiKey) {
    stations.push({
      name: 'brave',
      buildUrl: (q) => `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`,
      parse: parseBraveJson,
      headers: () => ({ Accept: 'application/json', 'X-Subscription-Token': opts.braveApiKey! }),
    });
  }
  // DDG lite первым в бэкапах (relsa/core.py: DDG_LITE, DDG, DDG_API), но
  // основной без ключей — html-фронт DDG (relsa/stations.py::resolve_station
  // дефолт при отсутствии SEARXNG/BRAVE).
  stations.push({ name: 'ddg', buildUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDdgHtml });
  stations.push({ name: 'ddg_lite', buildUrl: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, parse: parseDdgLite });
  return stations;
}

async function tryStation(
  station: Station,
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ results: SearchResult[]; error: string | null }> {
  try {
    const resp = await fetchWithTimeout(station.buildUrl(query), fetchImpl, timeoutMs, station.headers?.() || {});
    if (!resp.ok) {
      return { results: [], error: `HTTP ${resp.status}` };
    }
    const body = await resp.text();
    const results = station.parse(body, limit);
    if (results.length === 0 && station.name.startsWith('ddg')) {
      // Живой баг (relsa/core.py::_try_station): 200 OK + 0 результатов у
      // DDG-фронтов обычно значит капча/блок дата-центрового IP, а не
      // честный пустой поиск — помечаем явно.
      return { results: [], error: 'suspected_block: 200 OK но 0 результатов' };
    }
    return { results, error: null };
  } catch (exc: any) {
    return { results: [], error: `${exc?.name || 'Error'}: ${exc?.message || exc}` };
  }
}

/**
 * Каскад станций: первая НЕПУСТАЯ выдача побеждает. Ошибка или пустой
 * результат одной станции прозрачно уходит на следующую. Полный провал
 * цепочки → { results: [] } с error, БЕЗ исключения (relsa/core.py::search).
 */
export async function search(query: string, limit: number, opts: RelsaOptions = {}): Promise<SearchPayload> {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stations = buildStations(opts);

  let lastStation = stations[0]?.name || 'ddg';
  let lastError: string | null = null;
  const tried: string[] = [];

  for (const station of stations) {
    const { results, error } = await tryStation(station, query, limit, fetchImpl, timeoutMs);
    tried.push(station.name);
    lastStation = station.name;
    lastError = error;
    if (results.length > 0) {
      // Санитизация внешнего текста ДО возврата (G11).
      const cleaned = results.map((r) => ({
        title: stripSpecialTokens(r.title),
        snippet: stripSpecialTokens(r.snippet),
        url: r.url,
      }));
      const payload: SearchPayload = { station: station.name, query, results: cleaned };
      if (tried.length > 1) payload.stationsTried = tried;
      return payload;
    }
  }

  const payload: SearchPayload = { station: lastStation, query, results: [] };
  if (lastError) payload.error = lastError;
  if (tried.length > 1) payload.stationsTried = tried;
  return payload;
}

/**
 * Выкачка одной страницы → компактный текст. Санитизация спецтокенов
 * ОБЯЗАТЕЛЬНА (G11 — инъекция через скрейпленный контент, который мы не
 * контролируем). Парсинг — грубая вырезка тегов, без DOM (relsa/core.py::scrape_url).
 */
export async function scrapeUrl(url: string, opts: RelsaOptions = {}): Promise<ScrapePayload> {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let body: string;
  // SSRF-гард: URL приходит от модели (=пользователя) — тянуть внутренние/
  // метаданные-адреса нельзя. Проверка + ручное следование редиректам внутри.
  const fetched = await safeFetchFollow(url, fetchImpl, timeoutMs, opts.lookupImpl);
  if (fetched.error || !fetched.response) {
    return { url, title: '', text: '', error: fetched.error || 'запрос не выполнен' };
  }
  if (!fetched.response.ok) {
    return { url, title: '', text: '', error: `HTTP ${fetched.response.status}` };
  }
  try {
    body = await fetched.response.text();
  } catch (exc: any) {
    return { url, title: '', text: '', error: `${exc?.name || 'Error'}: ${exc?.message || exc}` };
  }

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  // Вырезаем шумные теги целиком (со своим содержимым) до вытяжки текста —
  // relsa/core.py::scrape_url убирает script/style/nav/header/footer/aside/
  // form/iframe/noscript через BeautifulSoup decompose().
  const cleanedHtml = body.replace(
    /<(script|style|nav|header|footer|aside|form|iframe|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );
  // Абзацы/пункты/заголовки длиннее 40 символов — отсекаем менюшные огрызки.
  const chunkRe = /<(p|li|h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = chunkRe.exec(cleanedHtml))) {
    const t = stripTags(m[2]);
    if (t.length > 40) chunks.push(t);
  }
  let text = chunks.join('\n');
  if (!text) {
    // страница без <p>/<li>/<h*> — берём весь текст как есть
    text = stripTags(cleanedHtml);
  }
  text = stripSpecialTokens(text); // G11
  if (text.length > SCRAPE_MAX_CHARS) {
    text = text.slice(0, SCRAPE_MAX_CHARS) + '…[обрезано]';
  }

  return { url, title: stripSpecialTokens(title), text };
}

// ─── Фабрики ToolDef ────────────────────────────────────────────────────

/** Инструмент 'рельса.search'. Схема аргументов сверена с TOOL_SPECS
 * референса: query maxLen 300, limit range 1-10. */
export function relsaSearchTool(opts: RelsaOptions = {}): ToolDef {
  return {
    name: 'рельса.search',
    description: 'Веб-поиск: найти актуальную информацию в интернете по запросу.',
    argsSchema: {
      query: { type: 'string', required: true, description: 'поисковый запрос', maxLen: 300 },
      limit: { type: 'number', required: false, description: 'сколько результатов вернуть', range: [1, 10] },
    },
    isWrite: false,
    execute: async (args) => {
      const query = String(args.query ?? '');
      const limit = typeof args.limit === 'number' ? args.limit : 5;
      return search(query, limit, opts);
    },
  };
}

/** Инструмент 'рельса.scrape_url'. */
export function relsaScrapeTool(opts: RelsaOptions = {}): ToolDef {
  return {
    name: 'рельса.scrape_url',
    description: 'Прочитать содержимое конкретной веб-страницы по URL.',
    argsSchema: {
      url: { type: 'string', required: true, description: 'адрес страницы', maxLen: 500 },
    },
    isWrite: false,
    execute: async (args) => {
      const url = String(args.url ?? '');
      return scrapeUrl(url, opts);
    },
  };
}
