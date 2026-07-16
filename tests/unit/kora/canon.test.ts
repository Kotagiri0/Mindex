import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeTool } from '../../../src/kora/canon.ts';

// Живой баг: смешанный алфавит (rельса.search, латинская r) канонизировался
// правильно, но диспетчер получал сырое имя, которого нет в реестре.
test('canonicalizeTool: смешанный алфавит (латинская r в кириллическом слове)', () => {
  assert.equal(canonicalizeTool('rельса.search'), 'рельса.search');
});

test('canonicalizeTool: транслит домена и метода → канон', () => {
  assert.equal(canonicalizeTool('relsa.search'), 'рельса.search');
});

// Живой баг: relsa.search и рельса.search с одинаковыми аргументами должны
// давать ОДИН И ТОТ ЖЕ канон, иначе дедуп повторных вызовов не поймает дубль.
test('canonicalizeTool: relsa.search и рельса.search дают один и тот же канон', () => {
  assert.equal(canonicalizeTool('relsa.search'), canonicalizeTool('рельса.search'));
});

test('canonicalizeTool: домены по первой букве', () => {
  assert.equal(canonicalizeTool('p.remember'), 'полисад.remember');
  assert.equal(canonicalizeTool('n.list'), 'навык.list');
  assert.equal(canonicalizeTool('a.load'), 'артефакт.load');
  assert.equal(canonicalizeTool('c.call'), 'сервис.call');
  assert.equal(canonicalizeTool('s.call'), 'сервис.call');
});

test('canonicalizeTool: методы по ключевым корням, регистронезависимо', () => {
  assert.equal(canonicalizeTool('РЕЛЬСА.SCRAPE_PAGE'), 'рельса.scrape_url');
  assert.equal(canonicalizeTool('полисад.store_fact'), 'полисад.remember');
  assert.equal(canonicalizeTool('рельса.recall_thread'), 'рельса.search');
  assert.equal(canonicalizeTool('артефакт.make_slides'), 'артефакт.slides');
  assert.equal(canonicalizeTool('артефакт.build_site'), 'артефакт.site');
  assert.equal(canonicalizeTool('сервис.call_webhook'), 'сервис.call');
  assert.equal(canonicalizeTool('навык.get_doc'), 'навык.load');
  assert.equal(canonicalizeTool('навык.list_all'), 'навык.list');
});

test('canonicalizeTool: неизвестный домен — тотальность, возвращает исходную строку', () => {
  assert.equal(canonicalizeTool('zzz.unknown'), 'zzz.unknown');
});

test('canonicalizeTool: детерминированность — повторный вызов даёт тот же результат', () => {
  const a = canonicalizeTool('rельса.search');
  const b = canonicalizeTool('rельса.search');
  assert.equal(a, b);
});
