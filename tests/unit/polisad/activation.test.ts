import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationScore, ACTIVATION_DECAY, SIM_WEIGHT } from '../../../src/polisad/activation.ts';
import { foldOverflowMessages, CONTEXT_WINDOW } from '../../../src/polisad/temporal.ts';

test('activationScore: без обращений — чистая семантика', () => {
  assert.equal(activationScore(0.8, 0), SIM_WEIGHT * 0.8);
});

test('activationScore: растёт с массой обращений', () => {
  const base = activationScore(0.7, 0);
  const used = activationScore(0.7, 5);
  assert.ok(used > base);
});

test('activationScore: часто вспоминаемый тред обгоняет чуть более похожий, но заброшенный', () => {
  // similarity 0.70 + большая масса обращений vs similarity 0.74 без обращений
  const activeMemory = activationScore(0.70, 8);   // ln(9) ≈ 2.20 > разница 0.4 по семантике
  const dormantMemory = activationScore(0.74, 0);
  assert.ok(activeMemory > dormantMemory);
});

test('activationScore: семантика доминирует при большом разрыве similarity', () => {
  // similarity 0.95 без обращений должна обгонять similarity 0.66 с любой разумной массой
  const strongMatch = activationScore(0.95, 0);
  const weakButUsed = activationScore(0.66, 20);
  assert.ok(strongMatch > weakButUsed);
});

test('activationScore: отрицательная масса не ломает логарифм', () => {
  assert.equal(activationScore(0.8, -1), SIM_WEIGHT * 0.8);
});

test('ACTIVATION_DECAY — классическое значение ACT-R', () => {
  assert.equal(ACTIVATION_DECAY, 0.5);
});

test('foldOverflowMessages: ≤ CONTEXT_WINDOW записей — пустая свёртка', () => {
  const msgs = Array.from({ length: CONTEXT_WINDOW }, (_, i) => ({ role: 'user', content: `m${i}` }));
  assert.equal(foldOverflowMessages(msgs), '');
});

test('foldOverflowMessages: переполнение — в свёртке только user-реплики из overflow', () => {
  const overflow = [
    { role: 'user', content: 'утро: встреча с Игорем' },
    { role: 'assistant', content: 'ок, записал' },
    { role: 'tool', content: '{"success":true}' },
  ];
  const window = Array.from({ length: CONTEXT_WINDOW }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const block = foldOverflowMessages([...overflow, ...window]);
  assert.ok(block.includes('встреча с Игорем'));
  assert.ok(!block.includes('записал'));
  assert.ok(!block.includes('success'));
});
