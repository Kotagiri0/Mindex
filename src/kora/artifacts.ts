// АРТЕФАКТ — производящие инструменты КОРЫ: из текста модели → HTML-файл.
// См. docs/PORTING_TO_TS.md раздел 4 и kora/artifacts.py как референс.
//
// Принцип топ-харнессов (Claude Artifacts, v0, Marp): модель не "рисует
// пиксели" — она пишет ДЕКЛАРАТИВНЫЙ формат (markdown), а детерминированный
// рендерер снаружи петли превращает его в артефакт. Рендер — чистая функция
// без сети и состояния.
//
// Два инструмента:
//   артефакт.slides — markdown со слайдами (разделитель "---") → один
//                      самодостаточный HTML с навигацией
//   артефакт.site   — markdown → одна самодостаточная страница
//
// Никаких CDN и внешних ресурсов в выводе (правило самодостаточности —
// файл должен открываться локально из Telegram/почты без интернета).
//
// СЕРВЕР: execute НЕ пишет на диск (в отличие от kora/artifacts.py::
// save_artifact) — возвращает { html, title, kind }, сохранение/раздача
// артефакта — забота server.ts (см. отчёт агента для интеграции).

import type { ToolDef } from './registry.js';
import { coerceArtifactArgs } from './coerce.js';

// ─── Экранирование HTML (перенос html.escape из Python) ────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Минимальный markdown → HTML ────────────────────────────────────────────
const CODE_SPAN_RE = /`([^`]+)`/g;
const INLINE_RULES: Array<[RegExp, (m: string, ...groups: string[]) => string]> = [
  [/\*\*([^*]+)\*\*/g, (_m, g1) => `<strong>${g1}</strong>`],
  [/\*([^*]+)\*/g, (_m, g1) => `<em>${g1}</em>`],
  // URL без кавычек/угловых скобок: кавычка в href разрывала атрибут — XSS
  // через [x](https://ex.com/"onclick="...). Схема — только http(s),
  // javascript: не пройдёт по построению.
  [/\[([^\]]+)\]\((https?:\/\/[^)\s"'<>]+)\)/g, (_m, g1, g2) => `<a href="${g2}">${g1}</a>`],
];

function inline(text: string): string {
  // литеральный \x00 из входа (скрейпленный контент) вычищаем — иначе
  // коллизия с плейсхолдерами стэша ниже подменяла текст содержимым кода
  let out = escapeHtml(text.replace(/\x00/g, ''));
  // код-спаны прячем в плейсхолдеры ДО остальных правил
  const stash: string[] = [];
  out = out.replace(CODE_SPAN_RE, (_m, g1) => {
    stash.push(`<code>${g1}</code>`);
    return `\x00${stash.length - 1}\x00`;
  });
  for (const [rx, repl] of INLINE_RULES) {
    out = out.replace(rx, repl as (substring: string, ...args: unknown[]) => string);
  }
  for (let i = 0; i < stash.length; i++) {
    out = out.replace(`\x00${i}\x00`, stash[i]);
  }
  return out;
}

/** Markdown → HTML-фрагмент. Поддержка: #/##/### заголовки, - списки,
 * ```код```, инлайн-разметка, параграфы. Всё лишнее — просто параграф. */
export function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeBuf: string[] = [];

  function closeList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const stripped = line.trim();
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(stripped);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
    } else if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(stripped.slice(2))}</li>`);
    } else if (!stripped) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(stripped)}</p>`);
    }
  }

  if (inCode) {
    // незакрытый ``` — дозакрываем
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  closeList();
  return out.join('\n');
}

// ─── Рендер слайдов ─────────────────────────────────────────────────────────
// UX по мотивам reveal.js/Marp: клавиатура, клик по половинам экрана,
// touch-свайпы (телефон — частый способ открыть артефакт из Telegram),
// хэш-навигация #N, прогресс-бар, печать в PDF через @media print — всё без
// внешних зависимостей.
const SLIDES_CSS = `
html,body{margin:0;height:100%;font-family:system-ui,-apple-system,'Segoe UI',
Roboto,sans-serif;background:#111;color:#eee}
.slide{display:none;box-sizing:border-box;height:100vh;padding:8vh 10vw;
overflow-y:auto}
.slide.active{display:block}
h1{font-size:2.6em;margin:.2em 0}h2{font-size:1.9em}h3{font-size:1.4em}
p,li{font-size:1.25em;line-height:1.5}
code{background:#222;padding:.1em .35em;border-radius:4px;font-size:.95em}
pre{background:#1b1b1b;padding:1em;border-radius:8px;overflow:auto}
pre code{background:none;padding:0}
a{color:#8ab4ff}
.nav{position:fixed;bottom:14px;right:18px;color:#666;font-size:.9em;
user-select:none}
#bar{position:fixed;left:0;bottom:0;height:3px;background:#8ab4ff;
width:0;transition:width .15s}
@media print{
.slide{display:block;page-break-after:always;height:auto;min-height:90vh;
background:#fff;color:#111}
html,body{background:#fff}
code{background:#eee}pre{background:#f4f4f4}a{color:#2058c8}
.nav,#bar{display:none}}
`.trim();

const SLIDES_JS = `
let i=0;const s=document.querySelectorAll('.slide');
function show(n,push){i=Math.max(0,Math.min(s.length-1,n));
s.forEach((el,k)=>el.classList.toggle('active',k===i));
document.getElementById('pos').textContent=(i+1)+' / '+s.length;
document.getElementById('bar').style.width=((i+1)/s.length*100)+'%';
if(push!==false)history.replaceState(null,'','#'+(i+1));}
document.addEventListener('keydown',e=>{
if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);
if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);
if(e.key==='Home')show(0);
if(e.key==='End')show(s.length-1);});
document.addEventListener('click',e=>{
if(e.target.closest('a'))return;
show(e.clientX>innerWidth/2?i+1:i-1);});
let tx=null;
document.addEventListener('touchstart',e=>{tx=e.touches[0].clientX});
document.addEventListener('touchend',e=>{if(tx===null)return;
const dx=e.changedTouches[0].clientX-tx;tx=null;
if(dx<-50)show(i+1);if(dx>50)show(i-1);});
window.addEventListener('hashchange',()=>{
const n=parseInt(location.hash.slice(1));if(n)show(n-1,false);});
const h=parseInt(location.hash.slice(1));
show(h?h-1:0,false);
`.trim();

// строка фронтматтера: латинский key: value. Кириллицу в ключе НЕ пускаем —
// русская проза «Вывод: рынок вырос» не должна выглядеть как фронтматтер
const FM_LINE_RE = /^[A-Za-z][\w-]*\s*:/;
const FM_KNOWN = [
  'marp', 'theme', 'title', 'paginate', 'class', 'style', 'size',
  'header', 'footer', 'author', 'description', 'headingdivider',
];

/** Убирает фронтматтер Marp, только если блок между '---' целиком состоит
 * из латинских key: value строк И содержит известный Marp-ключ. Иначе
 * первое '---' — обычная горизонтальная линия/разделитель слайда, резать
 * по нему контент нельзя (регрессы: «# Слайд: важное»,
 * «Вывод: рынок вырос» съедались как фронтматтер). */
function stripMarpFrontMatter(body: string): string {
  if (!body.startsWith('---\n')) return body;
  const end = body.indexOf('\n---', 4);
  if (end === -1) return body;
  const blockLines = body.slice(4, end).split(/\r?\n/).filter((ln) => ln.trim());
  const allMatch = blockLines.length > 0 && blockLines.every((ln) => FM_LINE_RE.test(ln));
  const hasKnown = blockLines.some((ln) => FM_KNOWN.includes(ln.split(':')[0].trim().toLowerCase()));
  if (allMatch && hasKnown) {
    return body.slice(end + 4);
  }
  return body;
}

/** Режет markdown на слайды по строкам '---', НЕ трогая '---' внутри
 * ```блоков кода``` (иначе код с диффом/выводом рвал презентацию). */
function splitSlides(body: string): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let inCode = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      cur.push(line);
      continue;
    }
    if (!inCode && /^-{3,}\s*$/.test(line)) {
      chunks.push(cur.join('\n').trim());
      cur = [];
      continue;
    }
    cur.push(line);
  }
  chunks.push(cur.join('\n').trim());
  return chunks.filter((c) => c);
}

/** Markdown с разделителями «---» → (самодостаточный HTML, число слайдов). */
export function renderSlides(title: string, markdown: string): { html: string; count: number } {
  const body = stripMarpFrontMatter(markdown.trim());
  let chunks = splitSlides(body);
  if (chunks.length === 0) chunks = [body || '(пусто)'];
  const sections = chunks.map((c) => `<section class="slide">${mdToHtml(c)}</section>`).join('\n');
  const safeTitle = escapeHtml(title);
  const html =
    `<!doctype html><html><head><meta charset='utf-8'>` +
    `<meta name='viewport' content='width=device-width,initial-scale=1'>` +
    `<title>${safeTitle}</title><style>${SLIDES_CSS}</style></head><body>\n${sections}\n` +
    `<div class='nav'><span id='pos'></span> · &larr;/&rarr;</div>` +
    `<div id='bar'></div><script>${SLIDES_JS}</script></body></html>`;
  return { html, count: chunks.length };
}

// ─── Рендер сайта ────────────────────────────────────────────────────────
const SITE_CSS = `
body{margin:0 auto;max-width:760px;padding:3em 1.5em;font-family:system-ui,
-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#222}
h1,h2,h3{line-height:1.25}
code{background:#f4f4f4;padding:.1em .35em;border-radius:4px}
pre{background:#f6f6f6;padding:1em;border-radius:8px;overflow:auto}
a{color:#2058c8}
img{max-width:100%;height:auto}
table{border-collapse:collapse;display:block;overflow-x:auto}
td,th{border:1px solid #ccc;padding:.4em .7em}
@media (prefers-color-scheme: dark){body{background:#111;color:#ddd}
code{background:#222}pre{background:#1b1b1b}a{color:#8ab4ff}
td,th{border-color:#444}}
`.trim();

/** Markdown → самодостаточная HTML-страница. */
export function renderSite(title: string, markdown: string): string {
  const body = mdToHtml(markdown);
  const safeTitle = escapeHtml(title);
  return (
    `<!doctype html><html><head><meta charset='utf-8'>` +
    `<meta name='viewport' content='width=device-width,initial-scale=1'>` +
    `<title>${safeTitle}</title><style>${SITE_CSS}</style></head><body>\n${body}\n</body></html>`
  );
}

// ─── Инструменты ─────────────────────────────────────────────────────────
export interface ArtifactResult {
  html: string;
  title: string;
  kind: 'slides' | 'site';
}

function extractTitleMarkdown(args: Record<string, unknown>): { title: string; markdown: string } {
  // coerceArtifactArgs — живой баг (ТЗ раздел 4): модель прислала
  // {"slides":[{title,content}]} вместо {"title","markdown"}. Применяем
  // ДО отказа, не после — иначе честный вызов теряется впустую.
  const coerced = coerceArtifactArgs(args, 'markdown');
  const title = typeof coerced.title === 'string' && coerced.title ? coerced.title : 'Без названия';
  const markdown = typeof coerced.markdown === 'string' ? coerced.markdown : '';
  return { title, markdown };
}

/** артефакт.slides — markdown со слайдами → самодостаточный HTML. */
export function artifactSlidesTool(): ToolDef {
  return {
    name: 'артефакт.slides',
    description: 'Собрать презентацию (слайды через "---" в markdown) в самодостаточный HTML',
    argsSchema: {
      title: { type: 'string', required: false, description: 'заголовок презентации', maxLen: 200 },
      markdown: { type: 'string', required: false, description: 'markdown слайдов, разделённых "---"' },
    },
    isWrite: false,
    execute: async (args): Promise<ArtifactResult> => {
      const { title, markdown } = extractTitleMarkdown(args);
      const { html } = renderSlides(title, markdown);
      return { html, title, kind: 'slides' };
    },
  };
}

/** артефакт.site — markdown → одностраничник. */
export function artifactSiteTool(): ToolDef {
  return {
    name: 'артефакт.site',
    description: 'Собрать одностраничный сайт из markdown в самодостаточный HTML',
    argsSchema: {
      title: { type: 'string', required: false, description: 'заголовок страницы', maxLen: 200 },
      markdown: { type: 'string', required: false, description: 'содержимое страницы в markdown' },
    },
    isWrite: false,
    execute: async (args): Promise<ArtifactResult> => {
      const { title, markdown } = extractTitleMarkdown(args);
      const html = renderSite(title, markdown);
      return { html, title, kind: 'site' };
    },
  };
}
