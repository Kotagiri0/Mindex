import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type ToolDef } from '../../../src/kora/registry.ts';
import type { ChatMessage } from '../../../src/kora/loop.ts';
import {
  isComposite,
  planSubtasks,
  runOrchestrated,
  type SubtaskResult,
} from '../../../src/kora/orchestrate.ts';

// ─── фикстуры ────────────────────────────────────────────────────────────

function searchTool(execute: ToolDef['execute']): ToolDef {
  return {
    name: 'рельса.search',
    description: 'поиск в вебе',
    argsSchema: {
      query: { type: 'string', required: true, description: 'поисковый запрос', maxLen: 300 },
    },
    isWrite: false,
    execute,
  };
}

function writeTool(execute: ToolDef['execute']): ToolDef {
  return {
    name: 'сервис.call',
    description: 'вызов внешнего сервиса (write)',
    argsSchema: {
      payload: { type: 'string', required: false, description: 'payload' },
    },
    isWrite: true,
    execute,
  };
}

/** Скриптованная модель по КЛЮЧУ (не по порядку, как в loop.test.ts) —
 * оркестрация зовёт generate() из нескольких независимых мест (план,
 * N подзадач параллельно, синтез), порядок вызовов недетерминирован. */
function keyedGenerate(pickResponse: (messages: ChatMessage[]) => string) {
  const calls: ChatMessage[][] = [];
  const fn = async (messages: ChatMessage[]) => {
    calls.push(messages.map((m) => ({ ...m })));
    return pickResponse(messages);
  };
  return { fn, calls, callCount: () => calls.length };
}

function lastUserContent(messages: ChatMessage[]): string {
  return messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
}

// ─── 1. Детектор составности ────────────────────────────────────────────

test('orchestrate: детектор — сводка по трём проектам → true', () => {
  assert.equal(isComposite('сделай сводку по трём проектам'), true);
});

test('orchestrate: детектор — сравни X и Y → true', () => {
  assert.equal(isComposite('сравни Notion и Todoist по цене'), true);
});

test('orchestrate: детектор — какая погода → false', () => {
  assert.equal(isComposite('какая погода в Москве'), false);
});

test('orchestrate: детектор — курсы валют → false (не составная)', () => {
  assert.equal(isComposite('какой сейчас курс доллара'), false);
});

test('orchestrate: детектор — нумерованный список в сообщении → true', () => {
  assert.equal(
    isComposite('нужно сделать:\n1. купить билеты\n2. забронировать отель'),
    true
  );
});

// ─── 2. Планировщик ──────────────────────────────────────────────────────

test('orchestrate: планировщик — модель отдаёт корректный список → 3 подзадачи', async () => {
  const gen = keyedGenerate(() => '1. а\n2. б\n3. в');
  const subtasks = await planSubtasks('сводка по трём проектам', gen.fn);
  assert.deepEqual(subtasks, ['а', 'б', 'в']);
});

test('orchestrate: планировщик — проза без списка → тихий откат ([])', async () => {
  const gen = keyedGenerate(() => 'Извините, не могу разбить эту задачу на части.');
  const subtasks = await planSubtasks('сводка по трём проектам', gen.fn);
  assert.deepEqual(subtasks, []);
});

// ─── несоставной запрос → runReactLoop напрямую, план-модель не вызывается ─

test('orchestrate: несоставной запрос — план-модель не вызывается, идёт обычная петля', async () => {
  const registry = new ToolRegistry();
  registry.register(searchTool(async () => ({ results: [] })));
  let planCalls = 0;
  const gen = keyedGenerate((messages) => {
    if (messages.some((m) => m.role === 'system' && m.content.includes('планировщик'))) {
      planCalls++;
    }
    return '<answer>Сегодня без осадков.</answer>';
  });

  const res = await runOrchestrated({
    userMsg: 'какая погода сегодня',
    registry,
    ctx: {},
    generate: gen.fn,
  });

  assert.equal(planCalls, 0);
  assert.equal(res.answer, 'Сегодня без осадков.');
});

// ─── 3. Параллель ────────────────────────────────────────────────────────

test('orchestrate: параллель — обе подзадачи исполнены, контексты чистые, onSubtaskDone вызван по мере готовности', async () => {
  const registry = new ToolRegistry();
  registry.register(searchTool(async () => ({ results: [{ title: 't', url: 'https://a.example/x' }] })));

  const gen = keyedGenerate((messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('планировщик')) {
      return '1. подзадача про проект А\n2. подзадача про проект Б';
    }
    // суб-агент: сразу отвечает без действий, эхом того, что видит в user-сообщении
    const userTxt = lastUserContent(messages);
    return `<answer>ответ по: ${userTxt}</answer>`;
  });

  const doneOrder: number[] = [];
  const doneResults: SubtaskResult[] = [];

  const res = await runOrchestrated({
    userMsg: 'сделай сводку по проекту А и проекту Б',
    registry,
    ctx: {},
    generate: gen.fn,
    onSubtaskDone: (idx, result) => {
      doneOrder.push(idx);
      doneResults.push(result);
    },
  });

  assert.equal(doneOrder.length, 2);
  assert.ok(doneOrder.includes(0) && doneOrder.includes(1));
  assert.equal(doneResults.every((r) => !r.failed), true);

  // контекст подзадачи №2 не содержит текста подзадачи №1
  const sub2Call = gen.calls.find((c) => lastUserContent(c) === 'подзадача про проект Б');
  assert.ok(sub2Call, 'должен быть вызов с чистым userMsg подзадачи №2');
  assert.ok(!sub2Call!.some((m) => m.content.includes('подзадача про проект А')));

  assert.ok(res.answer.length > 0);
});

test('orchestrate: write-инструмент недоступен подзадаче — execute не вызывается, даже если модель его зовёт', async () => {
  let writeExecuted = false;
  const registry = new ToolRegistry();
  registry.register(searchTool(async () => ({ results: [] })));
  registry.register(
    writeTool(async () => {
      writeExecuted = true;
      return { ok: true };
    })
  );

  const gen = keyedGenerate((messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('планировщик')) {
      return '1. первая часть\n2. вторая часть';
    }
    // суб-агент пытается вызвать write-инструмент — реестр подзадачи не должен его знать
    return '<action tool="сервис.call">{"payload": "x"}</action>';
  });

  await runOrchestrated({
    userMsg: 'сравни первую часть и вторую часть, сделай сводку',
    registry,
    ctx: {},
    generate: gen.fn,
  });

  assert.equal(writeExecuted, false);
});

// ─── 4. Синтез ───────────────────────────────────────────────────────────

test('orchestrate: одна подзадача провалена — в промпте синтеза «ПРОВАЛЕНА»', async () => {
  const registry = new ToolRegistry();
  registry.register(searchTool(async () => ({ results: [] })));

  let synthPromptSeen = '';
  const gen = keyedGenerate((messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('планировщик')) {
      return '1. часть один\n2. часть два';
    }
    const userTxt = lastUserContent(messages);
    if (userTxt.includes('Ты собирал ответ по частям')) {
      synthPromptSeen = userTxt;
      return '<answer>По части один есть данные, по части два — не нашёл.</answer>';
    }
    if (userTxt === 'часть один') {
      return '<answer>данные по части один</answer>';
    }
    // "часть два" — подзадача проваливается: generate падает исключением
    // (sanitizeFinalAnswer никогда не отдаёт пустую строку — фолбэк-заглушка
    // непустая, — поэтому единственный надёжный способ смоделировать провал
    // подзадачи в этом тесте это исключение внутри runReactLoop, которое
    // runSingleSubtask ловит и превращает в failed: true).
    throw new Error('подзадача упала');
  });

  const res = await runOrchestrated({
    userMsg: 'сравни часть один и часть два',
    registry,
    ctx: {},
    generate: gen.fn,
  });

  assert.ok(synthPromptSeen.includes('ПРОВАЛЕНА'));
  assert.ok(res.answer.includes('не нашёл') || res.answer.length > 0);
});

// ─── URL-скраб ───────────────────────────────────────────────────────────

test('orchestrate: URL-скраб — синтез вставил URL, которого нет в evidence, он вырезается', async () => {
  const registry = new ToolRegistry();
  registry.register(
    searchTool(async () => ({
      results: [{ title: 'реальный', url: 'https://real.example/data' }],
    }))
  );

  const gen = keyedGenerate((messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('планировщик')) {
      return '1. найди данные А\n2. найди данные Б';
    }
    const userTxt = lastUserContent(messages);
    if (userTxt.includes('Ты собирал ответ по частям')) {
      return '<answer>Вот подтверждённая ссылка https://real.example/data и выдуманная https://fake.example/invented</answer>';
    }
    // подзадачи: реальный вызов инструмента, потом честный ответ
    return (
      '<action tool="рельса.search">{"query": "x"}</action>'
    );
  });

  // подзадачи делают только один шаг action → на втором шаге отвечают
  const gen2 = keyedGenerate((messages) => {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    if (sys.includes('планировщик')) {
      return '1. найди данные А\n2. найди данные Б';
    }
    const hasResult = messages.some((m) => m.role === 'user' && m.content.includes('<result'));
    const userTxt = lastUserContent(messages);
    if (userTxt.includes('Ты собирал ответ по частям')) {
      return '<answer>Вот подтверждённая ссылка https://real.example/data и выдуманная https://fake.example/invented</answer>';
    }
    if (hasResult) {
      return '<answer>по данным: https://real.example/data</answer>';
    }
    return '<action tool="рельса.search">{"query": "x"}</action>';
  });

  const res = await runOrchestrated({
    userMsg: 'сравни данные А и данные Б',
    registry,
    ctx: {},
    generate: gen2.fn,
  });

  assert.ok(!res.answer.includes('fake.example/invented'));
  assert.ok(res.answer.includes('real.example/data'));
});
