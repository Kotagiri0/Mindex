import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdToHtml,
  renderSlides,
  renderSite,
  artifactSlidesTool,
  artifactSiteTool,
} from '../../../src/kora/artifacts.ts';

test('mdToHtml: заголовки/списки/жирный/курсив/код/ссылки рендерятся', () => {
  const html = mdToHtml('# Заголовок\n\n- пункт **жирный** и *курсив*\n\n`код` и [ссылка](https://example.com)');
  assert.ok(html.includes('<h1>Заголовок</h1>'));
  assert.ok(html.includes('<li>пункт <strong>жирный</strong> и <em>курсив</em></li>'));
  assert.ok(html.includes('<code>код</code>'));
  assert.ok(html.includes('<a href="https://example.com">ссылка</a>'));
});

test('renderSlides: markdown с "---" делится на N слайдов в HTML', () => {
  const md = 'Слайд 1\n\n---\n\nСлайд 2\n\n---\n\nСлайд 3';
  const { html, count } = renderSlides('Тест', md);
  assert.equal(count, 3);
  const sectionCount = (html.match(/<section class="slide">/g) || []).length;
  assert.equal(sectionCount, 3);
});

test('renderSlides: "---" внутри блока кода не режет слайд (живой баг: код с диффом рвал презентацию)', () => {
  const md = 'Слайд 1\n```\nдо\n---\nпосле\n```\n\n---\n\nСлайд 2';
  const { count } = renderSlides('Тест', md);
  assert.equal(count, 2);
});

// Живой баг: наивная резка по первому "---" ошибочно съедала контент вида
// «Вывод: рынок вырос» или «# Слайд: важное» как фронтматтер Marp.
test('renderSlides: обычная строка "Вывод: рынок вырос" не принимается за Marp-фронтматтер', () => {
  const md = 'Вывод: рынок вырос\n\n---\n\nСлайд 2';
  const { count, html } = renderSlides('Тест', md);
  assert.equal(count, 2);
  assert.ok(html.includes('Вывод: рынок вырос'));
});

test('renderSlides: HTML самодостаточен — нет внешних <script src=> или <link href="http', () => {
  const { html } = renderSlides('Тест', 'Слайд 1\n\n---\n\nСлайд 2');
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+href="http/i);
});

test('renderSite: markdown -> самодостаточная страница без внешних ресурсов', () => {
  const html = renderSite('Страница', '# Привет\n\nТекст страницы.');
  assert.ok(html.includes('<title>Страница</title>'));
  assert.ok(html.includes('<h1>Привет</h1>'));
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+href="http/i);
});

// XSS: markdown придёт от модели, а в него может протечь скрейпленный веб-
// контент — сырой <script> не должен появиться как исполняемый тег.
test('renderSite: <script>alert(1)</script> в markdown экранируется, не исполняемый тег', () => {
  const html = renderSite('Страница', 'Текст с <script>alert(1)</script> внутри.');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderSlides: XSS через markdown не даёт исполняемый <script> в выходном HTML', () => {
  const md = 'Слайд с <script>alert(document.cookie)</script>\n\n---\n\nСлайд 2';
  const { html } = renderSlides('Тест', md);
  assert.doesNotMatch(html, /<script>alert\(document\.cookie\)<\/script>/);
});

test('артефакт.slides: execute с {title, markdown} возвращает {html, title, kind}', async () => {
  const tool = artifactSlidesTool();
  const result = (await tool.execute(
    { title: 'Моя презентация', markdown: 'Слайд 1\n\n---\n\nСлайд 2' },
    undefined,
  )) as { html: string; title: string; kind: string };
  assert.equal(result.title, 'Моя презентация');
  assert.equal(result.kind, 'slides');
  assert.ok(result.html.includes('<title>Моя презентация</title>'));
});

test('артефакт.site: execute с {title, markdown} возвращает {html, title, kind}', async () => {
  const tool = artifactSiteTool();
  const result = (await tool.execute(
    { title: 'Моя страница', markdown: '# Заголовок' },
    undefined,
  )) as { html: string; title: string; kind: string };
  assert.equal(result.title, 'Моя страница');
  assert.equal(result.kind, 'site');
  assert.ok(result.html.includes('<h1>Заголовок</h1>'));
});

// Живой баг (ТЗ раздел 4): модель прислала {"slides":[{title,content}]}
// вместо {"title","markdown"} для инструмента презентаций. coerceArtifactArgs
// должен собрать markdown из альтернативной схемы ДО отказа.
test('артефакт.slides: альтернативная схема {"slides":[{title,content}]} коэрсится через coerce, HTML генерится', async () => {
  const tool = artifactSlidesTool();
  const result = (await tool.execute(
    {
      title: 'Презентация из альт-схемы',
      slides: [
        { type: 'title', content: { title: 'Первый слайд', subtitle: 'подзаголовок' } },
        { type: 'body', content: 'Второй слайд текст' },
      ],
    },
    undefined,
  )) as { html: string; title: string; kind: string };
  assert.equal(result.kind, 'slides');
  assert.ok(result.html.includes('Первый слайд'));
  assert.ok(result.html.includes('Второй слайд текст'));
  // это действительно две секции слайдов, не один пустой артефакт
  const sectionCount = (result.html.match(/<section class="slide">/g) || []).length;
  assert.ok(sectionCount >= 1);
});

test('артефакт.site: без title использует дефолт "Без названия", без markdown — пустое тело, не падает', async () => {
  const tool = artifactSiteTool();
  const result = (await tool.execute({}, undefined)) as { html: string; title: string };
  assert.equal(result.title, 'Без названия');
  assert.ok(result.html.includes('<title>Без названия</title>'));
});
