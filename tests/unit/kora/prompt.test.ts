import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type ToolDef } from '../../../src/kora/registry.ts';
import { buildSystemPrompt } from '../../../src/kora/prompt.ts';

function searchDef(): ToolDef {
  return {
    name: 'рельса.search',
    description: 'поиск в вебе',
    argsSchema: {
      query: { type: 'string', required: true, description: 'поисковый запрос' },
      limit: { type: 'number', required: false, description: 'лимит' },
    },
    isWrite: false,
    execute: async () => ({}),
  };
}

function rememberDef(): ToolDef {
  return {
    name: 'полисад.remember',
    description: 'сохранить факт в память',
    argsSchema: {
      key: { type: 'string', required: true, description: 'ключ факта' },
      value: { type: 'string', required: true, description: 'значение' },
    },
    isWrite: true,
    execute: async () => ({}),
  };
}

test('prompt: зарегистрированный инструмент попадает в промпт со своей схемой', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());
  reg.register(rememberDef());
  const prompt = buildSystemPrompt({ registry: reg });
  assert.ok(prompt.includes('рельса.search'));
  assert.ok(prompt.includes('query'));
  assert.ok(prompt.includes('полисад.remember'));
  assert.ok(prompt.includes('key'));
});

// Живой баг (ТЗ 1.3): промпт не должен обещать инструмент, которого нет в
// рантайме-реестре — каталог собирается динамически, не хардкодится.
test('prompt: НЕзарегистрированный инструмент отсутствует в тексте промпта', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());
  const prompt = buildSystemPrompt({ registry: reg });
  assert.equal(prompt.includes('артефакт.slides'), false);
  assert.equal(prompt.includes('сервис.call'), false);
});

test('prompt: анти-пример присутствует в тексте, когда есть инструменты', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());
  const prompt = buildSystemPrompt({ registry: reg });
  assert.ok(prompt.includes('НЕПРАВИЛЬНО'));
  assert.ok(prompt.includes('width'));
});

test('prompt: каталог навыков появляется только когда передан и непуст', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());

  const withoutSkills = buildSystemPrompt({ registry: reg });
  assert.equal(withoutSkills.includes('НАВЫКИ'), false);

  const withEmptySkills = buildSystemPrompt({ registry: reg, skillsCatalog: [] });
  assert.equal(withEmptySkills.includes('НАВЫКИ'), false);

  const withSkills = buildSystemPrompt({
    registry: reg,
    skillsCatalog: [{ name: 'дайджест', description: 'собрать сводку по проектам' }],
  });
  assert.ok(withSkills.includes('НАВЫКИ'));
  assert.ok(withSkills.includes('дайджест'));
});

test('prompt: каталог сервисов появляется только когда передан и непуст', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());
  const withServices = buildSystemPrompt({
    registry: reg,
    servicesCatalog: [{ name: 'telegram', description: 'отправка сообщений' }],
  });
  assert.ok(withServices.includes('СЕРВИСЫ'));
  assert.ok(withServices.includes('telegram'));
});

// Живой баг: пустой реестр не должен обещать формат <action>/<result> —
// иначе система описывает петлю вызовов инструментов, которых вызвать нельзя.
test('prompt: пустой реестр → нет блока формата action/result', () => {
  const reg = new ToolRegistry();
  const prompt = buildSystemPrompt({ registry: reg });
  assert.equal(prompt.includes('<action'), false);
  assert.equal(prompt.includes('ФОРМАТ ВЫЗОВА'), false);
});

test('prompt: persona добавляется сверху, если передана', () => {
  const reg = new ToolRegistry();
  reg.register(searchDef());
  const prompt = buildSystemPrompt({ registry: reg, persona: 'Ты — Мысль, дружелюбный помощник.' });
  assert.ok(prompt.startsWith('Ты — Мысль'));
});
