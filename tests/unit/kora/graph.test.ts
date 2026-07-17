import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphBuilder } from '../../../src/kora/graph.ts';
import type { LoopEvent } from '../../../src/kora/loop.ts';

// ─── happy path: один шаг с инструментом, финал ────────────────────────────

test('happy path: step_start → action → result → final, снимки живые', () => {
  const gb = new GraphBuilder();

  let nodes = gb.apply({ type: 'step_start', step: 1, label: 'Думаю над ответом' });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, 'step1');
  assert.equal(nodes[0].status, 'running');

  nodes = gb.apply({ type: 'action', step: 1, tool: 'рельса.search', detail: '{"query":"курс"}' });
  assert.equal(nodes[0].status, 'running');
  assert.ok(nodes[0].detail?.includes('рельса.search'));

  nodes = gb.apply({ type: 'result', step: 1, tool: 'рельса.search', detail: '{"rows":[1]}' });
  assert.ok(nodes[0].thought?.includes('готово'));

  nodes = gb.apply({ type: 'final', step: 2, detail: 'Курс такой-то' });
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].status, 'done'); // step1 закрыт
  assert.equal(nodes[1].id, 'final');
  assert.equal(nodes[1].status, 'done');
  assert.equal(nodes[1].detail, 'Курс такой-то');
});

// ─── эскалация: final сразу после blocked-серии → последний узел failed ────

test('эскалация: final после blocked-серии помечает последний рабочий узел failed', () => {
  const gb = new GraphBuilder();
  gb.apply({ type: 'step_start', step: 1 });
  gb.apply({ type: 'action', step: 1, tool: 'рельса.search' });
  gb.apply({ type: 'blocked', step: 1, tool: 'рельса.search', detail: 'ошибка' });
  gb.apply({ type: 'action', step: 1, tool: 'рельса.search' });
  gb.apply({ type: 'blocked', step: 1, tool: 'рельса.search', detail: 'ошибка' });
  const nodes = gb.apply({
    type: 'final',
    step: 1,
    detail: 'Не смог найти достоверные данные',
  });
  const step1 = nodes.find((n) => n.id === 'step1')!;
  assert.equal(step1.status, 'failed');
  const final = nodes.find((n) => n.id === 'final')!;
  assert.equal(final.status, 'done');
});

// ─── живой урок §8: один шаг без единого вызова инструмента — граф всё равно непустой ─

test('один шаг без инструментов — граф непустой (живой урок §8)', () => {
  const gb = new GraphBuilder();
  gb.apply({ type: 'step_start', step: 1, label: 'Думаю над ответом' });
  const nodes = gb.apply({ type: 'final', step: 1, detail: 'Простой ответ без инструментов' });
  assert.ok(nodes.length >= 2);
  assert.ok(nodes.some((n) => n.id === 'step1'));
  assert.ok(nodes.some((n) => n.id === 'final'));
  assert.ok(nodes.every((n) => n.status === 'done'));
});

// ─── blocked, не приводящий к final сразу, НЕ считается провалом сам по себе ─
// (живой урок из референса: freshness-дозапрос — штатный блок, ход продолжается)

test('blocked с последующим успешным result не приводит к failed на final', () => {
  const gb = new GraphBuilder();
  gb.apply({ type: 'step_start', step: 1 });
  gb.apply({ type: 'blocked', step: 1, label: 'Ответила без поиска — прошу проверить в вебе' });
  gb.apply({ type: 'step_start', step: 2 });
  gb.apply({ type: 'action', step: 2, tool: 'рельса.search' });
  gb.apply({ type: 'result', step: 2, tool: 'рельса.search', detail: '{"rows":[1]}' });
  const nodes = gb.apply({ type: 'final', step: 2, detail: 'Ответ найден' });
  assert.ok(nodes.every((n) => n.status !== 'failed'));
});

// ─── иммутабельность снимков ────────────────────────────────────────────────

test('снимки иммутабельны: два apply() возвращают разные массивы, старый не мутирован', () => {
  const gb = new GraphBuilder();
  const snap1 = gb.apply({ type: 'step_start', step: 1, label: 'A' });
  const snap1Copy = snap1.map((n) => ({ ...n }));
  const snap2 = gb.apply({ type: 'action', step: 1, tool: 'x' });

  assert.notEqual(snap1, snap2); // разные массивы
  assert.notEqual(snap1[0], snap2[0]); // разные объекты-узлы
  assert.deepEqual(snap1, snap1Copy); // старый снимок не изменился задним числом
});

// ─── маппинг событий по спеке (модель узла строго {id,label,status,detail,thought}) ─

test('модель узла содержит только спекой заданные поля', () => {
  const gb = new GraphBuilder();
  const nodes = gb.apply({ type: 'step_start', step: 1, label: 'Думаю' });
  const keys = Object.keys(nodes[0]).sort();
  for (const k of keys) {
    assert.ok(['id', 'label', 'status', 'detail', 'thought'].includes(k));
  }
});

// snapshot() без изменений
test('snapshot() возвращает текущее состояние без побочных эффектов', () => {
  const gb = new GraphBuilder();
  gb.apply({ type: 'step_start', step: 1, label: 'A' });
  const s1 = gb.snapshot();
  const s2 = gb.snapshot();
  assert.deepEqual(s1, s2);
  assert.notEqual(s1, s2);
});
