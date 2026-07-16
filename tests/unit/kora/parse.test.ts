import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActions } from '../../../src/kora/parse.ts';

test('parseActions: основной формат <action tool="...">{...}</action> парсится', () => {
  const actions = parseActions('<action tool="рельса.search">{"query": "rust async"}</action>');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'рельса.search');
  assert.equal(actions[0].rawTool, 'рельса.search');
  assert.deepEqual(actions[0].args, { query: 'rust async' });
  assert.equal(actions[0].truncated, false);
});

test('parseActions: основной формат — кавычки могут быть одинарные вокруг tool=', () => {
  const actions = parseActions(`<action tool='полисад.remember'>{"key": "v"}</action>`);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'полисад.remember');
});

// Живой баг: <полисад.remember>{"key":"v"}</полисад.remember> (JSON в теле
// без атрибута tool) терялось целиком, модель врала «сохранил», хотя вызова
// не было — худший класс провала, ложное подтверждение.
test('parseActions: ветка 2 — JSON в теле тега без атрибута tool', () => {
  const actions = parseActions('<полисад.remember>{"key":"v"}</полисад.remember>');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'полисад.remember');
  assert.equal(actions[0].rawTool, 'полисад.remember');
  assert.deepEqual(actions[0].args, { key: 'v' });
});

// Живой баг: генерация упёрлась в лимит токенов до </action> — основной
// regex требует закрытие, действие терялось целиком, сырой JSON вываливался
// пользователю как «ответ».
test('parseActions: ветка 3 — оборванный тег в конце текста восстанавливается', () => {
  const actions = parseActions('Думаю, надо поискать. <action tool="x.y">{"a": "b');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].truncated, true);
  assert.deepEqual(actions[0].args, { a: 'b' });
});

test('parseActions: закрытое действие + следом оборванное — оба сохранены', () => {
  const text = '<action tool="рельса.search">{"query": "a"}</action> текст <action tool="полисад.remember">{"key": "v"';
  const actions = parseActions(text);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].truncated, false);
  assert.deepEqual(actions[0].args, { query: 'a' });
  assert.equal(actions[1].truncated, true);
  assert.deepEqual(actions[1].args, { key: 'v' });
});

test('parseActions: сырой текст без действий → пустой массив', () => {
  const actions = parseActions('Просто финальный ответ без вызовов инструментов.');
  assert.deepEqual(actions, []);
});

test('parseActions: сырой текст с фигурными скобками, но без action-тегов → пустой массив', () => {
  const actions = parseActions('какой-то текст {не действие} и всё');
  assert.deepEqual(actions, []);
});

test('parseActions: несколько закрытых действий подряд', () => {
  const text = '<action tool="а.search">{"q":"1"}</action><action tool="а.search">{"q":"2"}</action>';
  const actions = parseActions(text);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].args, { q: '1' });
  assert.deepEqual(actions[1].args, { q: '2' });
});

// Живой баг (kora/orchestrator.py::_parse_args): модель суёт голую строку
// вместо JSON. Ремонт невозможен (нет `{`) — но терять вызов нельзя,
// намерение модели очевидно. Фолбэк {"query": raw}.
test('parseArgs: голая строка вместо JSON → фолбэк {query: raw}, вызов не теряется', () => {
  const actions = parseActions('<action tool="рельса.search">погода в москве</action>');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'рельса.search');
  assert.deepEqual(actions[0].args, { query: 'погода в москве' });
});

test('parseArgs: невосстановимый мусор → фолбэк, а не потеря действия', () => {
  const actions = parseActions('<action tool="рельса.search">>>>???</action>');
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].args, { query: '>>>???' });
});
