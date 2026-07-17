// НАВЫК — реестр процедурных модулей КОРЫ (skills). См. docs/PORTING_TO_TS.md
// раздел 10 и kora/skills.py как референс.
//
// Навык — папка skills/<имя>/SKILL.md: инструкция "как делать" задачу
// определённого рода. Не хардкод в системном промпте — внешний модуль,
// подгружаемый ПО ТРЕБОВАНИЮ через навык.load. Каталог (имя+описание) при
// этом инъецируется в системный промпт ВСЕГДА (buildSystemPrompt) — живой
// урок ТЗ §10: если полагаться на то, что модель ДОГАДАЕТСЯ вызвать
// "список навыков" в нужный момент — она не догадывается. Каталог перед
// глазами — узнавание, не вспоминание.
//
// Сервер — процесс-синглтон, навыки НЕ читаются с диска на каждый запрос:
// SkillStore — интерфейс с двумя имплементациями (InMemory для констант/
// тестов, DirSkillStore для локальной разработки с ленивым чтением с диска).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolDef } from './registry.js';

const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;

export interface SkillMeta {
  name: string;
  description: string;
}

/** (поля фронтматтера, тело). Фронтматтер — блок между двумя строками '---'
 * в начале файла. Нет фронтматтера → пустые поля, весь текст как тело.
 * Значения ключей — простые строки (name/description), без вложенного YAML. */
function parseFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { fields: {}, body: text };
  }
  const fields: Record<string, string> = {};
  let bodyStart: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      bodyStart = i + 1;
      break;
    }
    const idx = lines[i].indexOf(':');
    if (idx !== -1) {
      const key = lines[i].slice(0, idx).trim().toLowerCase();
      const val = lines[i].slice(idx + 1).trim();
      fields[key] = val;
    }
  }
  if (bodyStart === null) {
    // закрывающего '---' нет — считаем весь текст телом
    return { fields: {}, body: text };
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  return { fields, body };
}

/** Разбирает SKILL.md целиком: (метаданные с ENFORCE-обрезкой лимитов, тело).
 * Референс (kora/skills.py) обрезает name/description срезом до лимита —
 * не отказ, усечение (навык всё равно должен быть виден в каталоге, лучше
 * укороченное описание, чем выпавший из каталога навык). */
export function parseSkillFile(text: string, fallbackName: string): { meta: SkillMeta; body: string } {
  const { fields, body } = parseFrontMatter(text);
  const name = (fields.name || fallbackName).slice(0, NAME_MAX);
  const description = (fields.description || '').slice(0, DESCRIPTION_MAX);
  return { meta: { name, description }, body };
}

export interface SkillStore {
  list(): SkillMeta[];
  load(name: string): Promise<string | null>;
}

/** Навыки как константы в памяти — для тестов и первичного деплоя (без
 * файловой системы на сервере). */
export class InMemorySkillStore implements SkillStore {
  private readonly skills: Map<string, { meta: SkillMeta; body: string }> = new Map();

  constructor(entries: Array<{ meta: SkillMeta; body: string }> = DEFAULT_SKILLS) {
    for (const entry of entries) {
      const meta: SkillMeta = {
        name: entry.meta.name.slice(0, NAME_MAX),
        description: entry.meta.description.slice(0, DESCRIPTION_MAX),
      };
      this.skills.set(meta.name, { meta, body: entry.body });
    }
  }

  list(): SkillMeta[] {
    return Array.from(this.skills.values()).map((s) => s.meta);
  }

  async load(name: string): Promise<string | null> {
    return this.skills.get(name)?.body ?? null;
  }
}

/** Читает skills/<имя>/SKILL.md с диска. Список кешируется лениво (первый
 * list()/load() сканирует диск, дальше — из памяти); reload() сбрасывает
 * кеш. Отсутствие директории — не ошибка, пустой реестр (навыки —
 * опциональный слой). */
export class DirSkillStore implements SkillStore {
  private readonly root: string;
  private cache: Map<string, { meta: SkillMeta; path: string }> | null = null;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  reload(): void {
    this.cache = null;
  }

  private async ensure(): Promise<Map<string, { meta: SkillMeta; path: string }>> {
    if (this.cache) return this.cache;
    const found = new Map<string, { meta: SkillMeta; path: string }>();
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch {
      this.cache = found;
      return found;
    }
    for (const entry of entries.sort()) {
      const skillPath = path.join(this.root, entry, 'SKILL.md');
      try {
        const text = await fs.readFile(skillPath, 'utf-8');
        const { meta } = parseSkillFile(text, entry);
        found.set(meta.name, { meta, path: skillPath });
      } catch {
        continue; // нет SKILL.md в этой папке — пропускаем
      }
    }
    this.cache = found;
    return found;
  }

  list(): SkillMeta[] {
    // list() в интерфейсе синхронный (для дешёвого использования в
    // buildSystemPrompt), но диск асинхронный — для DirSkillStore нужно
    // сначала прогреть кеш явным await ensure(); синхронный list()
    // отдаёт то, что уже в кеше (пусто до первого прогрева).
    return this.cache ? Array.from(this.cache.values()).map((s) => s.meta) : [];
  }

  /** Явный асинхронный прогрев кеша — вызывать перед первым list(), если
   * кеш ещё не прогрет (например, на старте сервера). */
  async warm(): Promise<void> {
    await this.ensure();
  }

  async load(name: string): Promise<string | null> {
    const skills = await this.ensure();
    const entry = skills.get(name);
    if (!entry) return null;
    const text = await fs.readFile(entry.path, 'utf-8');
    const { body } = parseSkillFile(text, name);
    return body;
  }
}

/** [{name, description}] для инъекции в системный промпт (skillsCatalog у
 * buildSystemPrompt) — дёшево, тела не читаем. */
export function skillsCatalog(store: SkillStore): SkillMeta[] {
  return store.list();
}

/** навык.list — список навыков (имя+описание), без тел. */
export function skillListTool(store: SkillStore): ToolDef {
  return {
    name: 'навык.list',
    description: 'Список доступных навыков (процедур) с описаниями',
    argsSchema: {},
    isWrite: false,
    execute: async () => ({ skills: store.list() }),
  };
}

/** навык.load — тело конкретного навыка. Гибкость по имени поля (name ИЛИ
 * skill) — живой баг в референсе: модель путает, как назвать параметр
 * идентификатора. Неизвестный навык → честная ошибка в результате
 * инструмента (объект { error }), не исключение — падать петля не должна
 * на опечатке модели в имени навыка. */
export function skillLoadTool(store: SkillStore): ToolDef {
  return {
    name: 'навык.load',
    description: 'Загрузить полное содержимое навыка по имени',
    argsSchema: {
      name: { type: 'string', required: false, description: 'имя навыка' },
    },
    isWrite: false,
    execute: async (args) => {
      const raw = args.name ?? args.skill;
      const name = typeof raw === 'string' ? raw : '';
      if (!name) {
        return { error: 'не указано имя навыка. Формат вызова: {"name": "имя-навыка"}' };
      }
      const body = await store.load(name);
      if (body === null) {
        return { error: `навык "${name}" не найден` };
      }
      return { name, body };
    },
  };
}

// ─── Дефолтные навыки (перенесены из sreda-lm/skills/*) ────────────────────

const WEB_RESEARCH_BODY = `# Веб-ресёрч через РЕЛЬСУ

Процедура для вопросов про **свежие/актуальные** данные (новости, версии,
цены, релизы, «что вышло»). Ядру знать этого неоткуда — источник только веб.

## Шаги

1. **Начни с поиска, а не с ответа.** Первый ход на такой вопрос — всегда
   \`<action tool="рельса.search">{"query": "..."}</action>\`. Ответ по памяти
   на «свежий» вопрос = гарантированная выдумка.

2. **Запрос — конкретный и с временной привязкой.** Плохо: \`python\`. Хорошо:
   \`последняя версия Python 2026\`. Добавляй год/месяц, если спрашивают
   «сейчас/сегодня/последний».

3. **Углубись в один результат.** Сниппетов из выдачи часто мало. Возьми
   самый релевантный URL и прочитай его целиком:
   \`<action tool="рельса.scrape_url">{"url": "..."}</action>\`.

4. **Пусто или ошибка — ОДНА повторная попытка** другим запросом (шире или
   по-английски). Снова пусто — честно скажи в \`<answer>\`, что данных нет.

5. **Отвечай только тем, что реально в \`<result>\`.** Название, цифру, дату,
   ссылку бери из выдачи, не из головы. Если чего-то нет в результатах —
   этого нет в ответе.

## Категорически нельзя

- Выдумывать ссылки, цены, даты, номера версий, названия релизов.
- Дописывать \`<result>\` в свой вывод — результат вставляет только КОРА.
- Отвечать «свежий» вопрос без единого вызова инструмента.

## Хороший ответ

Краткий, по делу, с 1–3 проверенными ссылками из выдачи. Если данные
приблизительные (курс, погода) — оговори это явно.`;

const PERSONAL_BRIEF_BODY = `# Личный контекст через ПОЛИСАД

Процедура для вопросов, завязанных на пользователя: «мой стек», «моя
статья», «к чему я готовлюсь», а также мультишаг «найди свежее ПОД МЕНЯ».
Ответ живёт в памяти — не в вебе и не в весах.

## Шаги

1. **Не переспрашивай то, что в памяти.** Если спрашивают про «мой стек /
   мою книгу / мой забег», ответ уже есть у КОРЫ в профиле или достаётся
   \`<action tool="полисад.search">{"query": "..."}</action>\`. Спросить
   пользователя то, что лежит в памяти, — это провал, а не вежливость.

2. **Мультишаг: сначала память, потом веб.** «Подбери материалы для моей
   статьи» = два хода:
   - \`полисад.search\` → узнать ТЕМУ статьи (напр. агентные архитектуры);
   - \`рельса.search\` по этой теме → свежие материалы.

   Порядок важен: не ищи в вебе, пока не вытащил из памяти, ПО ЧЕМУ искать.
   Иначе будешь искать по чужой/выдуманной теме.

3. **Свяжи две части.** «Успею ли на конференцию» = достать из памяти
   город/период → искать конкретную конференцию → сопоставить. Ответ должен
   опираться и на память, и на выдачу.

4. **Запись факта — через инструмент.** «Запомни, что…» = вызвать
   \`<action tool="полисад.remember">{"key": "...", "value": "..."}</action>\`.
   Просто написать «запомнил» без вызова — ложное подтверждение, факт не
   сохранится.

## Категорически нельзя

- Переспрашивать данные, которые есть в памяти/профиле.
- Сохранять в память выдуманные факты или непроверенные ссылки — в ПОЛИСАД
  идёт только то, что подтверждено \`<result>\` или словами пользователя.
- Искать в вебе по теме, которую не достал из памяти.

## Хороший ответ

Опирается на реальный личный контекст, связывает память и свежие данные,
ничего не переспрашивает без нужды.`;

export const DEFAULT_SKILLS: Array<{ meta: SkillMeta; body: string }> = [
  {
    meta: {
      name: 'web-research',
      description:
        'Как качественно исследовать свежую тему в вебе через РЕЛЬСУ — от запроса до проверенного ответа со ссылками',
    },
    body: WEB_RESEARCH_BODY,
  },
  {
    meta: {
      name: 'personal-brief',
      description:
        'Как отвечать на личные вопросы и мультишаг память+веб — сперва достать контекст из ПОЛИСАДА, потом искать по нему',
    },
    body: PERSONAL_BRIEF_BODY,
  },
];
