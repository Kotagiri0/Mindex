import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBalancedObject, closeUnterminated, repairJson } from '../../../src/kora/json-repair.ts';

// Все кейсы взяты из docs/PORTING_TO_TS.md раздел 3 / kora/selftest.py —
// каждый воспроизводит конкретный живой баг ремонта JSON.

test('repairJson: одинарные кавычки чинятся на двойные', () => {
  const result = repairJson("{'query': 'x', 'limit': 3}");
  assert.deepEqual(result, { query: 'x', limit: 3 });
});

test('repairJson: висячая запятая перед закрывающей скобкой', () => {
  const result = repairJson('{"query": "x",}');
  assert.deepEqual(result, { query: 'x' });
});

test('repairJson: текст вокруг JSON вырезается', () => {
  const result = repairJson('вот запрос: {"query": "x"} мусор');
  assert.deepEqual(result, { query: 'x' });
});

test('repairJson: дозакрытие простого обрыва', () => {
  const result = repairJson('{"query": "x"');
  assert.deepEqual(result, { query: 'x' });
});

test('repairJson: вложенный обрыв внутри строки — закрыть кавычку, потом два }', () => {
  const result = repairJson('{"a": {"b": "text');
  assert.deepEqual(result, { a: { b: 'text' } });
});

test('repairJson: { и } внутри строкового значения не путают глубину', () => {
  const result = repairJson('{"a": "text with { and }"');
  assert.deepEqual(result, { a: 'text with { and }' });
});

test('repairJson: незакрытый массив + обрыв внутри строки 3-го уровня вложенности', () => {
  const raw = '{"slides": [{"title": "a"}, {"title": "b"}, {"style": {"color": "#';
  const result = repairJson(raw) as { slides: unknown[] } | null;
  assert.ok(result !== null, 'должен восстановиться в валидный объект');
  assert.ok(Array.isArray(result!.slides));
  assert.equal(result!.slides.length, 3);
  assert.deepEqual(result!.slides[0], { title: 'a' });
  assert.deepEqual(result!.slides[1], { title: 'b' });
  assert.deepEqual(result!.slides[2], { style: { color: '#' } });
});

test('repairJson: невалидный вход без объекта вообще → null', () => {
  assert.equal(repairJson('просто текст без фигурных скобок'), null);
});

test('repairJson: не портит валидные строки с одинарной кавычкой внутри (двойные кавычки уже есть)', () => {
  const result = repairJson(`{"query": "it's fine"}`);
  assert.deepEqual(result, { query: "it's fine" });
});

// ── findBalancedObject напрямую ──────────────────────────────────────────

test('findBalancedObject: возвращает null, если { нет вообще', () => {
  assert.equal(findBalancedObject('нет скобок тут'), null);
});

test('findBalancedObject: находит границу первого сбалансированного объекта', () => {
  assert.equal(findBalancedObject('{"a": 1} хвост {"b": 2}'), '{"a": 1}');
});

test('findBalancedObject: обрыв — возвращает остаток строки как есть', () => {
  assert.equal(findBalancedObject('{"a": "b'), '{"a": "b');
});

// ── closeUnterminated напрямую ───────────────────────────────────────────

test('closeUnterminated: LIFO порядок закрытия разных типов скобок', () => {
  assert.equal(closeUnterminated('{"a": [1, 2'), '{"a": [1, 2]}');
});

test('closeUnterminated: обрыв внутри строки — сначала кавычка, потом скобки', () => {
  assert.equal(closeUnterminated('{"a": "text'), '{"a": "text"}');
});
