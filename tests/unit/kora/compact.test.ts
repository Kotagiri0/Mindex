import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResultBlocks, compactMessageAt, type ChatMessage } from '../../../src/kora/compact.ts';

function bigSearchResult(): string {
  return JSON.stringify({
    query: 'rust async',
    results: Array.from({ length: 10 }, (_, i) => ({
      title: `Заголовок ${i}`,
      url: `https://example.com/${i}`,
      // "балласт" — длинное описание, которое компакция должна выкинуть
      description: 'x'.repeat(80),
    })),
  });
}

test('compact: длинный результат сжимается до выжимки (заголовки/url), без description', () => {
  const body = bigSearchResult();
  assert.ok(body.length > 350);
  const content = `текст модели\n<result tool="рельса.search">${body}</result>`;
  const out = compactResultBlocks(content);
  assert.ok(out.length < content.length);
  assert.ok(!out.includes('description'));
  assert.ok(out.includes('Заголовок 0'));
  assert.ok(out.includes('https://example.com/0'));
});

test('compact: короткий результат не трогаем', () => {
  const content = '<result tool="полисад.remember">{"stored": true, "key": "x"}</result>';
  assert.equal(compactResultBlocks(content), content);
});

test('compact: не-JSON тело обрезается грубо, но не роняет остальной текст', () => {
  const junk = 'y'.repeat(500);
  const content = `до <result tool="х.х">${junk}</result> после`;
  const out = compactResultBlocks(content);
  assert.ok(out.includes('до'));
  assert.ok(out.includes('после'));
  assert.ok(out.includes('…[сжато]'));
  assert.ok(out.length < content.length);
});

test('compactMessageAt: сжимает результат ПРОШЛОГО шага по индексу, свежий (не указанный) остаётся полным', () => {
  const oldBody = bigSearchResult();
  const freshBody = bigSearchResult();
  const messages: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'вопрос' },
    { role: 'assistant', content: '<action tool="рельса.search">{"query":"a"}</action>' },
    { role: 'user', content: `<result tool="рельса.search">${oldBody}</result>` }, // индекс 3 — прошлый шаг
    { role: 'assistant', content: '<action tool="рельса.search">{"query":"b"}</action>' },
    { role: 'user', content: `<result tool="рельса.search">${freshBody}</result>` }, // индекс 5 — свежий
  ];
  const out = compactMessageAt(messages, 3);
  assert.ok(!out[3].content.includes('description'), 'прошлый шаг должен быть сжат');
  assert.ok(out[5].content.includes('description'), 'свежий шаг должен остаться полным');
  // исходный массив не мутирован
  assert.ok(messages[3].content.includes('description'));
});
