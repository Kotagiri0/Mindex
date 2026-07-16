// Coerce чужой JSON-схемы для «производящих» инструментов. См.
// docs/PORTING_TO_TS.md раздел 4.
//
// Даже с идеальным системным промптом сильные модели ИНОГДА игнорируют
// формат и присылают свою схему. Живой пример (презентации): вместо
// {"title","markdown"} модель прислала
// {"slides":[{"type":"title","content":{"title":"...","subtitle":"..."}}]}.
//
// ВАЖНО: это growing whitelist, НЕ попытка объять любую мыслимую схему.
// Закрывает конкретный наблюдаемый класс — массив известного альтернативного
// имени с элементами title + (content|body|items). Расширяется по мере
// появления новых живых случаев, не заранее.

const ALT_ARRAY_KEYS = ['slides', 'sections', 'blocks'] as const;

/** Достаёт текстовое содержимое элемента: title + один из content/body/items. */
function extractItemMarkdown(item: unknown): string | null {
  if (item === null || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;

  const title = typeof obj.title === 'string' ? obj.title : null;

  let body: string | null = null;
  if (typeof obj.content === 'string') {
    body = obj.content;
  } else if (obj.content !== null && typeof obj.content === 'object') {
    // { content: { title, subtitle } } — живой случай из ТЗ (презентации)
    const content = obj.content as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof content.title === 'string') parts.push(content.title);
    if (typeof content.subtitle === 'string') parts.push(content.subtitle);
    if (typeof content.body === 'string') parts.push(content.body);
    if (parts.length > 0) body = parts.join('\n');
  } else if (typeof obj.body === 'string') {
    body = obj.body;
  } else if (Array.isArray(obj.items)) {
    body = obj.items.filter((x): x is string => typeof x === 'string').join('\n');
  }

  if (title && body) return `## ${title}\n${body}`;
  if (title) return `## ${title}`;
  if (body) return body;
  return null;
}

/** Ищет вложенный массив pages[].sections — ещё один наблюдаемый альтернативный формат. */
function findPagesSections(args: Record<string, unknown>): unknown[] | null {
  const pages = args.pages;
  if (!Array.isArray(pages)) return null;
  const sections: unknown[] = [];
  for (const page of pages) {
    if (page !== null && typeof page === 'object' && Array.isArray((page as Record<string, unknown>).sections)) {
      sections.push(...(page as Record<string, unknown>).sections as unknown[]);
    }
  }
  return sections.length > 0 ? sections : null;
}

/**
 * Если в args нет целевого поля (например "markdown"), но есть массив
 * известного альтернативного имени (slides/sections/blocks/pages[].sections)
 * с восстановимыми элементами — собирает целевое поле программно.
 * Возвращает новый объект args (не мутирует вход) либо исходные args без
 * изменений, если восстановить нечего.
 */
export function coerceArtifactArgs(
  args: Record<string, unknown>,
  targetField: string = 'markdown',
): Record<string, unknown> {
  if (typeof args[targetField] === 'string' && args[targetField]) {
    return args; // целевое поле уже есть — коэрсить нечего
  }

  let items: unknown[] | null = null;
  for (const key of ALT_ARRAY_KEYS) {
    const candidate = args[key];
    if (Array.isArray(candidate) && candidate.length > 0) {
      items = candidate;
      break;
    }
  }
  if (!items) {
    items = findPagesSections(args);
  }
  if (!items || items.length === 0) return args;

  const pieces = items
    .map(extractItemMarkdown)
    .filter((x): x is string => x !== null);

  if (pieces.length === 0) return args;

  return { ...args, [targetField]: pieces.join('\n\n') };
}
