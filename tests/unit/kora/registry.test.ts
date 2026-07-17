import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, validateArgs, type ToolDef } from '../../../src/kora/registry.ts';
import { canonicalizeTool } from '../../../src/kora/canon.ts';

function fakeSearch(): ToolDef {
  return {
    name: 'рельса.search',
    description: 'поиск в вебе',
    argsSchema: {
      query: { type: 'string', required: true, description: 'поисковый запрос', maxLen: 300 },
      limit: { type: 'number', required: false, description: 'лимит результатов', range: [1, 10] },
    },
    isWrite: false,
    execute: async () => ({ results: [] }),
  };
}

test('registry: get() по канону находит зарегистрированный инструмент', () => {
  const reg = new ToolRegistry();
  reg.register(fakeSearch());
  assert.ok(reg.has('рельса.search'));
  assert.equal(reg.get('рельса.search')?.name, 'рельса.search');
});

// Живой баг (ТЗ 1.2): диспетчер обязан канонизировать сырое имя ДО обращения
// к реестру — реестр сам этого не делает, get() по сырому транслиту не найдёт
// инструмент, даже если после canonicalizeTool() он существует.
test('registry: get() по сырому нетранслитерированному имени НЕ находит — диспетчер обязан канонизировать сам', () => {
  const reg = new ToolRegistry();
  reg.register(fakeSearch());
  assert.equal(reg.get('relsa.search'), undefined);
  // а вот через явную канонизацию — находит, это и есть контракт
  assert.equal(reg.get(canonicalizeTool('relsa.search'))?.name, 'рельса.search');
});

test('validateArgs: ловит отсутствие обязательного поля, текст ошибки содержит имя поля и шаблон вызова', () => {
  const def = fakeSearch();
  const res = validateArgs(def, {});
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.ok(res.error.includes('query'));
    assert.ok(res.error.includes('Формат вызова'));
  }
});

test('validateArgs: корректные args проходят без изменений', () => {
  const def = fakeSearch();
  const res = validateArgs(def, { query: 'тест', limit: 5 });
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.args, { query: 'тест', limit: 5 });
});

// Семантика референса (kora/tools.py): у 3B-моделей до 30% вызовов с битыми
// аргументами — чиним что чинится детерминированно, отказ только там, где
// чинить нечем. Отказывать на каждый битый вызов = жечь шаги впустую.
test('validateArgs: строка длиннее maxLen молча обрезается, не отклоняется', () => {
  const def = fakeSearch();
  const res = validateArgs(def, { query: 'а'.repeat(500) });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal((res.args.query as string).length, 300);
});

test('validateArgs: число вне диапазона зажимается (clamp), не отклоняется', () => {
  const def = fakeSearch();
  const res = validateArgs(def, { query: 'x', limit: 99 });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.args.limit, 10);
});

test('validateArgs: числовая строка приводится к числу ("5" → 5)', () => {
  const def = fakeSearch();
  const res = validateArgs(def, { query: 'x', limit: '5' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.args.limit, 5);
});

test('validateArgs: не-число в number-поле выкидывается — возьмётся дефолт инструмента', () => {
  const def = fakeSearch();
  const res = validateArgs(def, { query: 'x', limit: 'много' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal('limit' in res.args, false);
});

test('validateArgs: вход НЕ мутируется — возвращается исправленная копия', () => {
  const def = fakeSearch();
  const original = { query: 'а'.repeat(500) };
  const res = validateArgs(def, original);
  assert.equal(res.ok, true);
  assert.equal(original.query.length, 500); // оригинал не тронут
});

test('registry: subset() отдаёт независимый реестр, не делящий состояние с исходным', () => {
  const reg = new ToolRegistry();
  reg.register(fakeSearch());
  reg.register({
    name: 'полисад.remember',
    description: 'сохранить факт',
    argsSchema: { key: { type: 'string', required: true, description: '' }, value: { type: 'string', required: true, description: '' } },
    isWrite: true,
    execute: async () => ({ stored: true }),
  });

  const sub = reg.subset(['рельса.search']);
  assert.ok(sub.has('рельса.search'));
  assert.equal(sub.has('полисад.remember'), false);

  // независимость: регистрация в subset не должна попадать в исходный реестр
  sub.register({
    name: 'артефакт.slides',
    description: 'слайды',
    argsSchema: {},
    isWrite: false,
    execute: async () => ({}),
  });
  assert.equal(reg.has('артефакт.slides'), false);
  assert.equal(reg.list().length, 2);
  assert.equal(sub.list().length, 2);
});
