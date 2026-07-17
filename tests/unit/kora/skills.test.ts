import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  InMemorySkillStore,
  DirSkillStore,
  parseSkillFile,
  skillsCatalog,
  skillListTool,
  skillLoadTool,
  DEFAULT_SKILLS,
} from '../../../src/kora/skills.ts';

test('parseSkillFile: фронтматтер парсится (name/description отделяются от тела)', () => {
  const text = '---\nname: test-skill\ndescription: тестовое описание\n---\n\n# Тело\nтекст';
  const { meta, body } = parseSkillFile(text, 'fallback');
  assert.equal(meta.name, 'test-skill');
  assert.equal(meta.description, 'тестовое описание');
  assert.equal(body, '# Тело\nтекст');
});

test('parseSkillFile: без фронтматтера — имя из fallback, весь текст как тело', () => {
  const text = '# Просто markdown без фронтматтера';
  const { meta, body } = parseSkillFile(text, 'my-folder');
  assert.equal(meta.name, 'my-folder');
  assert.equal(meta.description, '');
  assert.equal(body, text);
});

// Живой баг: лимиты agentskills (name<=64, description<=1024) должны
// соблюдаться усечением, а не отказом — навык всё равно должен попасть в
// каталог, лучше укороченное описание, чем выпавший навык.
test('parseSkillFile: лимиты name<=64 и description<=1024 соблюдаются усечением', () => {
  const longName = 'x'.repeat(100);
  const longDesc = 'y'.repeat(2000);
  const text = `---\nname: ${longName}\ndescription: ${longDesc}\n---\nтело`;
  const { meta } = parseSkillFile(text, 'fallback');
  assert.equal(meta.name.length, 64);
  assert.equal(meta.description.length, 1024);
});

test('InMemorySkillStore: каталог отдаёт все навыки (name+description)', () => {
  const store = new InMemorySkillStore();
  const catalog = skillsCatalog(store);
  assert.ok(catalog.length >= 2);
  const names = catalog.map((s) => s.name);
  assert.ok(names.includes('web-research'));
  assert.ok(names.includes('personal-brief'));
  for (const entry of catalog) {
    assert.ok(entry.name.length <= 64);
    assert.ok(entry.description.length <= 1024);
  }
});

test('InMemorySkillStore: load возвращает тело навыка по точному имени', async () => {
  const store = new InMemorySkillStore();
  const body = await store.load('web-research');
  assert.ok(body);
  assert.ok(body!.includes('Веб-ресёрч через РЕЛЬСУ'));
});

test('InMemorySkillStore: load неизвестного навыка → null (честная ошибка, не исключение)', async () => {
  const store = new InMemorySkillStore();
  const body = await store.load('несуществующий-навык');
  assert.equal(body, null);
});

test('навык.list: execute отдаёт каталог из store', async () => {
  const store = new InMemorySkillStore();
  const tool = skillListTool(store);
  const result = (await tool.execute({}, undefined)) as { skills: unknown[] };
  assert.ok(Array.isArray(result.skills));
  assert.ok(result.skills.length >= 2);
});

test('навык.load: работает по полю "name"', async () => {
  const store = new InMemorySkillStore();
  const tool = skillLoadTool(store);
  const result = (await tool.execute({ name: 'web-research' }, undefined)) as { name: string; body: string };
  assert.equal(result.name, 'web-research');
  assert.ok(result.body.includes('РЕЛЬСУ'));
});

// Гибкость по имени параметра — живой баг референса: модель путает, как
// назвать параметр идентификатора навыка (name vs skill).
test('навык.load: работает по полю "skill" (альтернативное имя параметра)', async () => {
  const store = new InMemorySkillStore();
  const tool = skillLoadTool(store);
  const result = (await tool.execute({ skill: 'personal-brief' }, undefined)) as { name: string; body: string };
  assert.equal(result.name, 'personal-brief');
  assert.ok(result.body.includes('ПОЛИСАД'));
});

test('навык.load: неизвестный навык → объект с error, не исключение', async () => {
  const store = new InMemorySkillStore();
  const tool = skillLoadTool(store);
  const result = (await tool.execute({ name: 'нет-такого' }, undefined)) as { error: string };
  assert.ok(result.error.includes('нет-такого'));
});

test('навык.load: без имени вообще → error с шаблоном вызова', async () => {
  const store = new InMemorySkillStore();
  const tool = skillLoadTool(store);
  const result = (await tool.execute({}, undefined)) as { error: string };
  assert.ok(result.error.length > 0);
});

test('DEFAULT_SKILLS: содержит перенесённые web-research и personal-brief', () => {
  const names = DEFAULT_SKILLS.map((s) => s.meta.name);
  assert.deepEqual(names.sort(), ['personal-brief', 'web-research']);
});

// DirSkillStore — дисковая имплементация для локальной разработки.
// Покрываем через временную папку (node:os tmpdir), т.к. это дешёвая
// проверка, а не сетевая/внешняя зависимость.
test('DirSkillStore: читает SKILL.md с диска, warm() прогревает кеш, list/load работают', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kora-skills-'));
  const skillDir = path.join(tmpRoot, 'my-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: my-skill\ndescription: тестовый навык с диска\n---\n\nТело навыка с диска.',
    'utf-8',
  );

  const store = new DirSkillStore(tmpRoot);
  // до прогрева list() пуст — читать диск на каждый list() нельзя (сервер-синглтон)
  assert.equal(store.list().length, 0);

  await store.warm();
  const catalog = store.list();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, 'my-skill');
  assert.equal(catalog[0].description, 'тестовый навык с диска');

  const body = await store.load('my-skill');
  assert.equal(body, 'Тело навыка с диска.');

  const missing = await store.load('нет-такого');
  assert.equal(missing, null);

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('DirSkillStore: отсутствие директории — не ошибка, пустой список', async () => {
  const store = new DirSkillStore(path.join(os.tmpdir(), 'kora-skills-nonexistent-' + Date.now()));
  await store.warm();
  assert.deepEqual(store.list(), []);
});
