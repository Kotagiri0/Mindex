// Компакция контекста — guardrail 10. См. docs/PORTING_TO_TS.md раздел 2 и
// kora/orchestrator.py::_compact_result_blocks/_compact_payload.
//
// Живой урок: полный JSON результата инструмента нужен модели ровно один
// шаг — чтобы отреагировать на него следующим действием/ответом. Дальше он
// в истории чистый балласт: dense-ядро (и любая API-модель, платящая за
// токены) пересчитывает его на КАЖДОМ следующем шаге. Сжимаем результаты
// ПРОШЛОГО шага (не текущего!) до выжимки (заголовки/URL/ошибки/факт
// сохранения) — свежий шаг остаётся полным, чтобы модель видела все детали
// того, что только что произошло.
//
// ВАЖНО: evidence-буфер TurnState (raздел turn-state.ts) НЕ имеет отношения
// к этому модулю и никогда не сжимается — guardrails 1/5/6 (антифабрикация,
// remember-guard, write-payload-guard) сверяются с полным несжатым
// evidence, а не с историей сообщений модели.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Совпадает по форме с тем, что диспетчер петли кладёт в контекст:
// <result tool="домен.метод">{...JSON...}</result>
const RESULT_BLOCK_RE = /(<result tool="([^"]+)">)([\s\S]*?)(<\/result>)/g;

// Короткие результаты не трогаем — сжимать нечего, риск испортить смысл
// выше выигрыша в токенах.
const COMPACT_MIN = 350;

/** Поля верхнего уровня, которые модель может захотеть "вспомнить" даже
 * из старого результата (совпадает с Python-референсом _compact_payload). */
const KEEP_KEYS = [
  'station', 'query', 'error', 'hint', 'stored', 'key',
  'is_explicit', 'url', 'title',
] as const;

interface ResultLike {
  results?: unknown;
  rows?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

/** Выжимка результата инструмента — заголовки/URL/ошибки/факт сохранения,
 * без полных тел (описаний, длинных текстов). */
function compactPayload(data: ResultLike): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEEP_KEYS) {
    if (k in data) out[k] = data[k];
  }
  if (Array.isArray(data.results)) {
    out.results = data.results
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({ title: r.title ?? '', url: r.url ?? '' }));
  }
  if (Array.isArray(data.rows)) {
    out.rows = data.rows
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        title: r.title ?? '',
        summary: typeof r.summary === 'string' ? r.summary.slice(0, 120) : '',
      }));
  }
  if (typeof data.text === 'string' && data.text) {
    out.text = data.text.slice(0, 150) + '…[сжато]';
  }
  return out;
}

/**
 * Сжимает все <result>...</result> блоки в тексте одного сообщения.
 * Короткие результаты (< COMPACT_MIN символов тела) и не-JSON тела
 * оставляются как есть либо усекаются грубо (repair невозможен — это не
 * ответственность этого модуля).
 */
export function compactResultBlocks(content: string): string {
  return content.replace(RESULT_BLOCK_RE, (full, head: string, _tool: string, body: string, tail: string) => {
    if (body.length < COMPACT_MIN) return full;
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return head + body.slice(0, COMPACT_MIN) + '…[сжато]' + tail;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return full;
    return head + JSON.stringify(compactPayload(data as ResultLike)) + tail;
  });
}

/**
 * Сжимает В МЕСТЕ (возвращает новый массив, не мутирует исходный) ОДНО
 * конкретное сообщение истории по индексу — это сообщение с <result>-блоками
 * предыдущего шага. Вызывающая петля сама решает, какой индекс сжимать
 * (позиция user-сообщения с результатами предыдущего шага), потому что
 * "прошлый шаг" — понятие петли, не этого модуля.
 */
export function compactMessageAt(messages: ChatMessage[], index: number): ChatMessage[] {
  if (index < 0 || index >= messages.length) return messages;
  const target = messages[index];
  const compacted = compactResultBlocks(target.content);
  if (compacted === target.content) return messages;
  const out = messages.slice();
  out[index] = { ...target, content: compacted };
  return out;
}
