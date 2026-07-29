import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReplyContext, stripReplyContext, REPLY_QUOTE_LIMIT } from '../../../src/lib/telegram-reply';

test('ответ на сообщение бота → маркер "твоё сообщение" с цитатой', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'Купи молоко' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "Купи молоко"]');
});

test('ответ на своё сообщение (is_bot отсутствует) → маркер "своё сообщение"', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { id: 1 }, text: 'Напомни завтра' },
  });
  assert.equal(result, '[Отвечает на своё сообщение: "Напомни завтра"]');
});

test('ответ на своё сообщение (is_bot: false) → маркер "своё сообщение"', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: false }, text: 'Ещё раз' },
  });
  assert.equal(result, '[Отвечает на своё сообщение: "Ещё раз"]');
});

test('reply_to_message есть, но поле from отсутствует полностью → "своё сообщение"', () => {
  const result = buildReplyContext({
    reply_to_message: { text: 'Без поля from' },
  });
  assert.equal(result, '[Отвечает на своё сообщение: "Без поля from"]');
});

test('quote.text приоритетнее reply_to_message.text', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'Полный текст сообщения целиком' },
    quote: { text: 'выделенный фрагмент' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "выделенный фрагмент"]');
});

test('fallback на caption, когда text отсутствует', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, caption: 'Подпись к фото' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "Подпись к фото"]');
});

test('короткая цитата (в пределах лимита) возвращается как есть, без разделителя', () => {
  const text = 'а'.repeat(REPLY_QUOTE_LIMIT);
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text },
  });
  assert.equal(result, `[Отвечает на твоё сообщение: "${text}"]`);
});

test('обрезка длинной цитаты — голова + хвост через " … "', () => {
  // Собираем текст так, чтобы голова и хвост были различимы.
  const longText = 'A'.repeat(300) + 'B'.repeat(300);
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: longText },
  });
  assert.ok(result);
  const match = result!.match(/^\[Отвечает на твоё сообщение: "(.*)"\]$/s);
  assert.ok(match, 'маркер должен соответствовать ожидаемому формату');
  const quote = match![1];

  // Содержит начало и конец исходного текста.
  assert.ok(quote.startsWith('A'.repeat(200)), 'должна остаться голова из первых 200 символов');
  assert.ok(quote.endsWith('B'.repeat(200)), 'должна остаться хвост из последних 200 символов');
  // Разделитель — ровно пробел, многоточие, пробел.
  assert.ok(quote.includes(' … '), 'разделитель должен быть " … "');
  assert.equal(quote, 'A'.repeat(200) + ' … ' + 'B'.repeat(200));
});

test('эмодзи ровно на границе обрезки не ломается на суррогат', () => {
  // 199 обычных символов + эмодзи (суррогатная пара) на границе QUOTE_HEAD=200,
  // затем длинный хвост, чтобы точно превысить REPLY_QUOTE_LIMIT.
  const head = 'a'.repeat(199) + '🎉'; // 199 code points + 1 code point (эмодзи) = 200
  const tail = 'b'.repeat(200);
  const filler = 'c'.repeat(50); // чтобы точно превысить REPLY_QUOTE_LIMIT
  const longText = head + filler + tail;

  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: longText },
  });
  assert.ok(result);
  const match = result!.match(/^\[Отвечает на твоё сообщение: "(.*)"\]$/s);
  const quote = match![1];

  // Нет одиночных суррогатов — строка состоит из целых code points.
  const noLoneSurrogates = [...quote].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c < 0xd800 || c > 0xdfff;
  });
  assert.ok(noLoneSurrogates, 'не должно быть одиночных суррогатных code units');
  assert.equal(Buffer.from(quote, 'utf8').toString('utf8'), quote);
  assert.ok(quote.includes('🎉'), 'эмодзи на границе должен остаться целым');
});

test('схлопывание переводов строк и лишних пробелов в один пробел', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'Строка1\n\n  Строка2\t\tСтрока3' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "Строка1 Строка2 Строка3"]');
});

test('вырезание [ и ] и замена " на \' внутри цитаты', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'текст [служебный маркер] и "кавычки"' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "текст служебный маркер и \'кавычки\'"]');
});

test('скобки с пробелами внутри не оставляют двойных пробелов', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'смотри [ вот это ] дальше' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "смотри вот это дальше"]');
  assert.ok(!result!.includes('  '), 'в цитате не должно быть двойных пробелов');
});

test('external_reply + quote без reply_to_message → "из другого чата"', () => {
  const result = buildReplyContext({
    external_reply: {},
    quote: { text: 'цитата из чужого чата' },
  });
  assert.equal(result, '[Отвечает на сообщение из другого чата: "цитата из чужого чата"]');
});

test('reply на голосовое без текста (своё) → маркер без цитаты', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { id: 1 }, voice: {} },
  });
  assert.equal(result, '[Отвечает на своё голосовое сообщение]');
});

test('reply на голосовое сообщение бота → "твоё голосовое сообщение"', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, voice: {} },
  });
  assert.equal(result, '[Отвечает на твоё голосовое сообщение]');
});

test('голый external_reply без quote → null (Telegram не даёт текста)', () => {
  const result = buildReplyContext({
    external_reply: {},
  });
  assert.equal(result, null);
});

test('нет reply и нет quote → null', () => {
  const result = buildReplyContext({});
  assert.equal(result, null);
});

test('цитата из одних пробелов → null', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: '   \n\t  ' },
  });
  assert.equal(result, null);
});

// ─── stripReplyContext ──────────────────────────────────────────────────────

test('stripReplyContext снимает маркер "твоё сообщение"', () => {
  const marker = '[Отвечает на твоё сообщение: "цитата"]';
  assert.equal(stripReplyContext(`${marker}\nтекст пользователя`), 'текст пользователя');
});

test('stripReplyContext снимает маркер "своё сообщение"', () => {
  const marker = '[Отвечает на своё сообщение: "цитата"]';
  assert.equal(stripReplyContext(`${marker}\nтекст пользователя`), 'текст пользователя');
});

test('stripReplyContext снимает маркер "из другого чата"', () => {
  const marker = '[Отвечает на сообщение из другого чата: "цитата"]';
  assert.equal(stripReplyContext(`${marker}\nтекст пользователя`), 'текст пользователя');
});

test('stripReplyContext снимает голосовой маркер', () => {
  const marker = '[Отвечает на твоё голосовое сообщение]';
  assert.equal(stripReplyContext(`${marker}\nтекст пользователя`), 'текст пользователя');
});

test('stripReplyContext не трогает текст без маркера', () => {
  const text = 'обычное сообщение без реплая';
  assert.equal(stripReplyContext(text), text);
});

test('stripReplyContext не трогает маркер в середине текста', () => {
  const text = 'привет\n[Отвечает на твоё сообщение: "цитата"]\nещё текст';
  assert.equal(stripReplyContext(text), text);
});

test('stripReplyContext: round-trip — маркер + \\n + текст возвращает исходный текст', () => {
  const marker = '[Отвечает на твоё сообщение: "цитата"]';
  const text = 'исходный текст пользователя';
  assert.equal(stripReplyContext(marker + '\n' + text), text);
});

test('stripReplyContext: многострочный текст пользователя — снимается только маркер', () => {
  const marker = '[Отвечает на своё сообщение: "цитата"]';
  const text = 'строка первая\nстрока вторая\nстрока третья';
  assert.equal(stripReplyContext(`${marker}\n${text}`), text);
});

// ─── round-trip: buildReplyContext → stripReplyContext ─────────────────────
// Проверяем не хардкод маркера, а реальную связку продюсера и консьюмера:
// то, что реально строит buildReplyContext, должно полностью сниматься
// stripReplyContext, оставляя ровно исходный текст пользователя.

function assertRoundTrip(input: Parameters<typeof buildReplyContext>[0], userText = 'текст пользователя') {
  const marker = buildReplyContext(input);
  assert.ok(marker, 'buildReplyContext должен вернуть маркер для этого входа');
  assert.equal(stripReplyContext(`${marker}\n${userText}`), userText);
}

test('round-trip: ответ на сообщение бота', () => {
  assertRoundTrip({ reply_to_message: { from: { is_bot: true }, text: 'Купи молоко' } });
});

test('round-trip: ответ на своё сообщение', () => {
  assertRoundTrip({ reply_to_message: { from: { id: 1 }, text: 'Напомни завтра' } });
});

test('round-trip: ответ на сообщение из другого чата', () => {
  assertRoundTrip({ external_reply: {}, quote: { text: 'цитата из чужого чата' } });
});

test('round-trip: голосовое сообщение бота', () => {
  assertRoundTrip({ reply_to_message: { from: { is_bot: true }, voice: {} } });
});

test('round-trip: своё голосовое сообщение', () => {
  assertRoundTrip({ reply_to_message: { from: { id: 1 }, voice: {} } });
});

test('round-trip: цитата обрезана по голове и хвосту (длинный текст > REPLY_QUOTE_LIMIT)', () => {
  const longText = 'A'.repeat(300) + 'B'.repeat(300);
  assertRoundTrip({ reply_to_message: { from: { is_bot: true }, text: longText } });
});

test('round-trip: цитата со спецсимволами \\ и $ — replace не должен их интерпретировать', () => {
  const trickyText = 'Цена: $100, путь C:\\Users\\vadim, шаблон $& и $1 внутри';
  assertRoundTrip({ reply_to_message: { from: { is_bot: true }, text: trickyText } });
});

// ─── регрессия: узкий REPLY_MARKER_RE не должен резать чужой текст ─────────

test('регрессия: похожая на маркер, но не наша форма — "[Отвечает на бабушку]" не снимается', () => {
  const text = '[Отвечает на бабушку]\nостальной текст';
  assert.equal(stripReplyContext(text), text);
});

test('регрессия: "[Отвечает на твоё сообщение]" без цитаты — не наша форма, не снимается', () => {
  const text = '[Отвечает на твоё сообщение]\nтекст';
  assert.equal(stripReplyContext(text), text);
});

test('регрессия: "[Отвечает на своё сообщение: без кавычек]" — не наша форма, не снимается', () => {
  const text = '[Отвечает на своё сообщение: без кавычек]\nтекст';
  assert.equal(stripReplyContext(text), text);
});

// ─── эмодзи на границе ХВОСТА (последние 200 code points) ──────────────────

test('эмодзи ровно на границе хвоста (QUOTE_TAIL=200) не ломается на суррогат', () => {
  // 250 обычных символов (голова с запасом, чтобы точно превысить REPLY_QUOTE_LIMIT),
  // затем эмодзи как первый code point хвоста (последние 200 code points) + 199 обычных.
  const head = 'a'.repeat(250);
  const tail = '🎉' + 'b'.repeat(199); // 1 + 199 = 200 code points
  const longText = head + tail;

  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: longText },
  });
  assert.ok(result);
  const match = result!.match(/^\[Отвечает на твоё сообщение: "(.*)"\]$/s);
  assert.ok(match, 'маркер должен соответствовать ожидаемому формату');
  const quote = match![1];

  // Нет одиночных суррогатов — строка состоит из целых code points.
  const noLoneSurrogates = [...quote].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c < 0xd800 || c > 0xdfff;
  });
  assert.ok(noLoneSurrogates, 'не должно быть одиночных суррогатных code units');
  assert.equal(Buffer.from(quote, 'utf8').toString('utf8'), quote);
  assert.ok(quote.includes('🎉'), 'эмодзи на границе хвоста должен остаться целым');
  assert.ok(quote.endsWith('b'.repeat(199)), 'хвост должен заканчиваться на исходные символы после эмодзи');
});

// ─── fallback цитаты: quote.text пустая строка ─────────────────────────────

test('quote.text === "" (пустая строка) → цитата берётся из reply_to_message.text (через ||, не ??)', () => {
  const result = buildReplyContext({
    reply_to_message: { from: { is_bot: true }, text: 'Текст из reply_to_message' },
    quote: { text: '' },
  });
  assert.equal(result, '[Отвечает на твоё сообщение: "Текст из reply_to_message"]');
});
