import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateAtLastAction,
  stripFakeResults,
  sanitizeFinalAnswer,
  checkDuplicate,
  checkBudget,
  checkRememberGuard,
  checkWritePayloadGuard,
  runPreCallGuards,
} from '../../../src/kora/guards.ts';
import { TurnState, callKey } from '../../../src/kora/turn-state.ts';
import { parseActions } from '../../../src/kora/parse.ts';
import type { ParsedAction } from '../../../src/kora/types.ts';

function action(tool: string, args: Record<string, unknown>): ParsedAction {
  return { tool, rawTool: tool, args, raw: JSON.stringify(args), truncated: false };
}

// ─── G1 — анти-фабрикация <result> ─────────────────────────────────────────

test('G1: вывод модели с самодописанным <result> после action обрезается по концу action', () => {
  const out =
    '<action tool="рельса.search">{"query":"погода"}</action>' +
    '<result tool="рельса.search">{"results":["выдумка"]}</result>' +
    '<answer>вот ответ по выдумке</answer>';
  const truncated = truncateAtLastAction(out);
  assert.equal(
    truncated,
    '<action tool="рельса.search">{"query":"погода"}</action>'
  );
  assert.ok(!truncated.includes('<result'));
});

test('G1: фейковый <result> вырезается из любого текста модели перед показом', () => {
  const text = 'Вот что нашёл: <result tool="x.y">{"a":1}</result> и ответ.';
  const clean = stripFakeResults(text);
  assert.ok(!clean.includes('<result'));
  assert.ok(clean.includes('Вот что нашёл'));
});

test('G1: текст без action не обрезается', () => {
  const out = 'Просто финальный ответ без действий.';
  assert.equal(truncateAtLastAction(out), out);
});

// ─── G2 — сырые теги не показываются пользователю ──────────────────────────

test('G2: оборванный <action> в финальном тексте пользователь не видит', () => {
  const text = 'Начал делать <action tool="x.y">{"a":"b';
  const clean = sanitizeFinalAnswer(text);
  assert.ok(!clean.includes('<action'));
});

test('G2: текст состоящий только из action-тега даёт честную заглушку, не пустоту', () => {
  const text = '<action tool="x.y">{"a":"b"}</action>';
  const clean = sanitizeFinalAnswer(text);
  assert.notEqual(clean, '');
  assert.ok(clean.length > 0);
});

test('G2: <answer> извлекается, оставшийся action вокруг него игнорируется', () => {
  const text = '<action tool="x.y">{}</action><answer>Готово, вот результат</answer>';
  assert.equal(sanitizeFinalAnswer(text), 'Готово, вот результат');
});

test('G2: чистый ответ без тегов проходит без изменений', () => {
  const text = 'Обычный ответ пользователю.';
  assert.equal(sanitizeFinalAnswer(text), text);
});

// ─── G3 — дедуп вызовов ─────────────────────────────────────────────────────

test('G3: смешанный алфавит рельса.search / relsa.search с одинаковыми args — дубль', () => {
  const state = new TurnState('какая погода');
  const [a1] = parseActions('<action tool="рельса.search">{"query":"x"}</action>');
  const [a2] = parseActions('<action tool="relsa.search">{"query":"x"}</action>');

  assert.equal(checkDuplicate(state, a1), null);
  state.recordCall(a1.tool + '::' + JSON.stringify({ query: 'x' }), a1.tool);
  // канон одинаковый, ключ дедупа строится по канону — второй вызов блокируется
  const block = checkDuplicate(state, a2);
  assert.ok(block && block.includes('уже вызывался'));
});

test('G3: те же args в другом порядке ключей тоже считаются дублем', () => {
  const state = new TurnState('');
  const a1 = action('рельса.search', { query: 'x', limit: 3 });
  const a2 = action('рельса.search', { limit: 3, query: 'x' });

  assert.equal(checkDuplicate(state, a1), null);
  state.recordCall(
    a1.tool + '::' + JSON.stringify({ limit: 3, query: 'x' }),
    a1.tool
  );
  const block = checkDuplicate(state, a2);
  assert.ok(block && block.includes('уже вызывался'));
});

test('G3: runPreCallGuards блокирует повтор через официальный callKey', () => {
  const state = new TurnState('');
  const a1 = action('рельса.search', { query: 'x', limit: 3 });
  const a2 = action('рельса.search', { limit: 3, query: 'x' });

  const first = runPreCallGuards(state, a1);
  assert.equal(first.allowed, true);
  // имитируем то, что оркестратор делает после успешного allowed=true
  state.recordCall(callKey(a1.tool, a1.args), a1.tool);

  const second = runPreCallGuards(state, a2);
  assert.equal(second.allowed, false);
  assert.ok(second.blockMessage?.includes('уже вызывался'));
});

// ─── G4 — бюджет вызовов на инструмент за ход ──────────────────────────────

test('G4: N+1-й вызов рельса.search за ход блокируется (лимит 4)', () => {
  const state = new TurnState('');
  for (let i = 0; i < 4; i++) {
    const a = action('рельса.search', { query: `q${i}` });
    assert.equal(checkBudget(state, a), null);
    state.recordCall(`key${i}`, a.tool);
  }
  const fifth = action('рельса.search', { query: 'q5' });
  const block = checkBudget(state, fifth);
  assert.ok(block && block.includes('лимит вызовов'));
  assert.ok(block!.includes('рельса.search'));
});

test('G4: дефолтный лимит 5 для инструмента без явного бюджета', () => {
  const state = new TurnState('');
  for (let i = 0; i < 5; i++) {
    const a = action('артефакт.unknown_method_but_canon_fallback', { i });
    // используем инструмент, которого нет в TOOL_BUDGET
    assert.equal(checkBudget(state, a), null);
    state.recordCall(`k${i}`, a.tool);
  }
  const over = action('артефакт.unknown_method_but_canon_fallback', { i: 99 });
  assert.ok(checkBudget(state, over) !== null);
});

// ─── G5 — remember-guard ────────────────────────────────────────────────────

test('G5: remember с URL, которого нет в evidence, блокируется', () => {
  const state = new TurnState('запомни мой любимый цвет');
  const a = action('полисад.remember', { value: 'сайт https://fake-example.test/x' });
  const block = checkRememberGuard(state, a);
  assert.ok(block && block.includes('ЗАБЛОКИРОВАНО'));
  assert.ok(block!.includes('https://fake-example.test/x'));
});

test('G5: remember с URL из реального результата инструмента пропускается', () => {
  const state = new TurnState('запомни этот сайт');
  state.addEvidence(JSON.stringify({ results: ['https://real-example.test/x'] }));
  const a = action('полисад.remember', { value: 'сайт https://real-example.test/x' });
  assert.equal(checkRememberGuard(state, a), null);
});

test('G5: remember по явной просьбе пользователя «запомни X» без evidence пропускается', () => {
  const state = new TurnState('запомни, что я люблю кофе');
  const a = action('полисад.remember', { value: 'любит кофе' });
  assert.equal(checkRememberGuard(state, a), null);
});

test('G5: remember без evidence и без просьбы пользователя блокируется (ничем не подтверждён)', () => {
  const state = new TurnState('привет, как дела?');
  const a = action('полисад.remember', { value: 'выдуманный факт' });
  const block = checkRememberGuard(state, a);
  assert.ok(block && block.includes('не подтверждён'));
});

test('G5: не-remember действия guard не трогает', () => {
  const state = new TurnState('');
  const a = action('рельса.search', { query: 'https://anything.test' });
  assert.equal(checkRememberGuard(state, a), null);
});

// ─── G6 — write-payload guard ───────────────────────────────────────────────

test('G6: write-payload с выдуманным URL блокируется ДО очереди подтверждения', () => {
  const state = new TurnState('отправь ссылку в чат');
  const a = action('сервис.call', {
    action: 'send_message',
    text: 'вот ссылка https://totally-made-up.test/link',
  });
  const block = checkWritePayloadGuard(state, a, true);
  assert.ok(block && block.includes('ЗАБЛОКИРОВАНО'));
});

test('G6: write-payload с проверенным URL (из evidence) не блокируется', () => {
  const state = new TurnState('отправь ссылку в чат');
  state.addEvidence(JSON.stringify({ url: 'https://verified.test/page' }));
  const a = action('сервис.call', {
    action: 'send_message',
    text: 'https://verified.test/page',
  });
  assert.equal(checkWritePayloadGuard(state, a, true), null);
});

test('G6: read-действие (isWriteAction=false) не проверяется этим guard-ом', () => {
  const state = new TurnState('');
  const a = action('рельса.search', { query: 'https://made-up.test/x' });
  assert.equal(checkWritePayloadGuard(state, a, false), null);
});

// ─── runPreCallGuards — порядок и композиция ───────────────────────────────

test('runPreCallGuards: чистый первый вызов пропускается', () => {
  const state = new TurnState('привет');
  const a = action('рельса.search', { query: 'test' });
  const result = runPreCallGuards(state, a);
  assert.equal(result.allowed, true);
  assert.equal(result.blockMessage, undefined);
});

test('runPreCallGuards: бюджет проверяется раньше remember-guard (порядок G3→G4→G5→G6)', () => {
  const state = new TurnState('');
  for (let i = 0; i < 3; i++) {
    const a = action('полисад.remember', { value: `выдумка ${i}` });
    // args разные — дедуп не сработает, сработает либо remember-guard, либо бюджет
    // на первых трёх вызовах remember-guard блокирует раньше, т.к. бюджет 3 не исчерпан
    const res = runPreCallGuards(state, a);
    assert.equal(res.allowed, false);
    assert.ok(res.blockMessage?.includes('ЗАБЛОКИРОВАНО'));
  }
  // бюджет полисад.remember не тратился (заблокированные вызовы не тратят бюджет —
  // recordCall не вызывается вызывающим кодом), так что четвёртый тоже упрётся в remember-guard
  const a4 = action('полисад.remember', { value: 'ещё выдумка' });
  const res4 = runPreCallGuards(state, a4);
  assert.equal(res4.allowed, false);
});

// Ревью-регрессия: фабрикация в САМОМ финальном ответе (не в промежуточном
// шаге) — G1 требует вырезать <result> из любого текста перед показом.
test('G2+G1: фейковый <result> в финальном ответе вырезается перед показом', () => {
  const out = sanitizeFinalAnswer('Вот данные: <result tool="рельса.search">{"fake":1}</result> держи.');
  assert.ok(!out.includes('<result'));
  assert.ok(out.includes('Вот данные:'));
});

test('G2: текст из одного фейкового <result> → заглушка, не пустота', () => {
  const out = sanitizeFinalAnswer('<result>{"a":1}</result>');
  assert.ok(out.length > 0);
  assert.ok(!out.includes('<result'));
});

// Ревью-регрессия: дедуп должен ловить перестановку ключей и во ВЛОЖЕННЫХ
// объектах (эквивалент json.dumps(sort_keys=True) из Python-референса).
test('G3: вложенные args с переставленными ключами → тот же дубль', () => {
  const state = new TurnState('вопрос');
  const a1 = { tool: 'сервис.call', rawTool: 'сервис.call', args: { name: 'tg', payload: { chat: 1, text: 'hi' } }, raw: '', truncated: false };
  const a2 = { tool: 'сервис.call', rawTool: 'сервис.call', args: { payload: { text: 'hi', chat: 1 }, name: 'tg' }, raw: '', truncated: false };
  assert.equal(checkDuplicate(state, a1), null);
  state.recordCall(callKey(a1.tool, a1.args), a1.tool);
  assert.ok(checkDuplicate(state, a2) !== null);
});
