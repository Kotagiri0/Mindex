import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationScore, jaccard, SIM_WEIGHT } from '../../../src/polisad/activation.ts';
import { stemRu, extractKeywords } from '../../../src/polisad/morphology.ts';

// ── Spreading activation ──────────────────────────────────────────────────────

test('assocMass: связанный с текущим контекстом тред получает буст', () => {
  const isolated = activationScore(0.7, 0, 0);
  const connected = activationScore(0.7, 0, 5);
  assert.ok(connected > isolated);
});

test('assocMass: ассоциация слабее прямой истории обращений (потолки 1.5 < 2.5)', () => {
  const byAccess = activationScore(0.7, 1000, 0);   // упирается в потолок 2.5
  const byAssoc = activationScore(0.7, 0, 1000);    // упирается в потолок 1.5
  assert.ok(byAccess > byAssoc);
});

test('инвариант: история + ассоциации вместе компенсируют не более 0.25 similarity', () => {
  // запас 0.26 по similarity непробиваем любой историей и любыми связями
  const strongMatch = activationScore(0.96, 0, 0);
  const weakButConnected = activationScore(0.70, 1e9, 1e9);
  assert.ok(strongMatch > weakButConnected);
});

test('activationScore: обратная совместимость — третий аргумент опционален', () => {
  assert.equal(activationScore(0.8, 0), SIM_WEIGHT * 0.8);
});

// ── Стеммер ───────────────────────────────────────────────────────────────────

test('stemRu: падежи сводятся к одной основе', () => {
  const stems = new Set(['задачу', 'задачи', 'задачей', 'задачами'].map(stemRu));
  assert.equal(stems.size, 1);
  assert.ok(stems.has('задач'));
});

test('stemRu: короткие слова и латиница не трогаются', () => {
  assert.equal(stemRu('дом'), 'дом');
  assert.equal(stemRu('deploy'), 'deploy');
  assert.equal(stemRu('api123'), 'api123');
});

test('stemRu: основа не короче 4 символов', () => {
  for (const w of ['планы', 'встреча', 'проектами']) {
    assert.ok(stemRu(w).length >= 4, `${w} → ${stemRu(w)}`);
  }
});

test('extractKeywords: стеммит и ограничивает топ-5', () => {
  const kw = extractKeywords('Напомни про задачи проекта Mindex на завтра утром и вечером');
  assert.ok(kw.length <= 5);
  assert.ok(kw.includes('задач'));
});

// ── Jaccard (детектор повторов) ───────────────────────────────────────────────

test('jaccard: одинаковые наборы = 1, непересекающиеся = 0', () => {
  assert.equal(jaccard(['а', 'б'], ['а', 'б']), 1);
  assert.equal(jaccard(['а'], ['б']), 0);
  assert.equal(jaccard([], ['б']), 0);
});

test('jaccard: переформулированный запрос о том же ловится порогом 0.5', () => {
  // «когда встреча с Игорем» vs «во сколько встреча с Игорем» (после стемминга)
  const q1 = extractKeywords('когда встреча с Игорем завтра');
  const q2 = extractKeywords('во сколько встреча с Игорем завтра');
  assert.ok(jaccard(q1, q2) >= 0.5);
});
