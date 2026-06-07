import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDay, parseTime, formatTime } from '../../../src/lib/timeline';
import { Task } from '../../../src/types';

const mk = (id: string, time = '', endTime = '', extra: Partial<Task> = {}): Task =>
  ({ id, name: id, time, endTime, date: '2026-06-08', done: false, ...extra } as Task);

// ── parseTime: границы суток и битый ввод ──
test('parseTime парсит границы и отбраковывает мусор', () => {
  assert.equal(parseTime('00:00'), 0);
  assert.equal(parseTime('23:59'), 1439);
  assert.equal(parseTime('24:00'), null);   // суток не бывает
  assert.equal(parseTime('12:60'), null);   // минут не бывает
  assert.equal(parseTime('9:5'), null);     // минуты в одну цифру — невалидно
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(undefined), null);
});

// ── formatTime: клампинг в [0, 24ч) ──
test('formatTime клампит и форматирует', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(1439), '23:59');
  assert.equal(formatTime(-30), '00:00');   // отрицательное → 0
  assert.equal(formatTime(2000), '23:59');  // больше суток → конец
});

// ── ЮЗ-КЕЙС: пустой день ──
test('пустой день даёт пустую раскладку', () => {
  assert.deepEqual(layoutDay([], 600), []);
});

// ── ЮЗ-КЕЙС: одна задача со временем ──
test('одна задача со временем размещается как есть', () => {
  const r = layoutDay([mk('a', '10:00', '11:00')], 600);
  assert.equal(r.length, 1);
  assert.equal(r[0].startMin, 600);
  assert.equal(r[0].endMin, 660);
  assert.equal(r[0].cols, 1);
});

// ── ЮЗ-КЕЙС: start без end → дефолтная длительность ──
test('задача без конца получает длительность по умолчанию (60 мин)', () => {
  const r = layoutDay([mk('a', '10:00')], 600);
  assert.equal(r[0].endMin, 660);
});

// ── ЮЗ-КЕЙС: битые данные end<=start ──
test('end меньше или равно start обрабатывается без поломки', () => {
  const r1 = layoutDay([mk('a', '10:00', '09:00')], 600);
  assert.equal(r1[0].endMin, 660); // невалидный конец игнорится, дефолт +60
  const r2 = layoutDay([mk('a', '10:00', '10:00')], 600);
  assert.ok(r2[0].endMin >= r2[0].startMin + 15); // минимальная высота блока
});

// ── ЮЗ-КЕЙС: наложение → колонки разводятся ──
test('две пересекающиеся задачи встают в две колонки', () => {
  const r = layoutDay([mk('a', '10:00', '11:00'), mk('b', '10:30', '11:30')], 600);
  assert.equal(r[0].cols, 2);
  assert.equal(r[1].cols, 2);
  assert.notEqual(r[0].col, r[1].col);
});

// ── ЮЗ-КЕЙС: касающиеся встык НЕ считаются наложением ──
test('последовательные задачи остаются в одной колонке', () => {
  const r = layoutDay([mk('a', '10:00', '11:00'), mk('b', '11:00', '12:00')], 600);
  assert.equal(r[0].cols, 1);
  assert.equal(r[1].cols, 1);
});

// ── ЮЗ-КЕЙС: задача без времени → агент прикидывает слот ──
test('задача без времени получает слот в рабочем окне', () => {
  const r = layoutDay([mk('a')], 10 * 60);
  assert.equal(r.length, 1);
  assert.equal(r[0].untimed, true);
  assert.ok(r[0].startMin >= 8 * 60);  // не раньше начала рабочего окна
  assert.ok(r[0].endMin <= 23 * 60);   // не позже конца рабочего окна
});

// ── ЮЗ-КЕЙС: предложение агента (suggestedTime) соблюдается ──
test('suggestedTime ставится напрямую', () => {
  const r = layoutDay([mk('a', '', '', { suggestedTime: '14:00', suggestedEndTime: '14:30' })], 600);
  assert.equal(r[0].startMin, 840); // 14:00
  assert.equal(r[0].endMin, 870);   // 14:30
  assert.equal(r[0].untimed, true);
});

// ── ЮЗ-КЕЙС: чип без времени не садится поверх занятого слота ──
test('без времени не пересекает занятый интервал', () => {
  const r = layoutDay([mk('busy', '10:00', '12:00'), mk('free')], 10 * 60);
  const free = r.find(p => p.task.id === 'free')!;
  const overlapsBusy = free.startMin < 720 && free.endMin > 600;
  assert.equal(overlapsBusy, false);
});

// ── ЮЗ-КЕЙС: реальный смешанный день ──
test('смешанный день раскладывается целиком', () => {
  const day = [
    mk('завтрак', '08:00', '08:30', { category: 'personal' }),
    mk('созвон', '10:00', '11:00', { category: 'event' }),
    mk('созвон2', '10:30', '11:30', { category: 'work' }),  // наложение с созвоном
    mk('уроки'),                                             // без времени
    mk('вебинар', '', '', { suggestedTime: '15:00', suggestedEndTime: '16:00' }),
  ];
  const r = layoutDay(day, 9 * 60);
  assert.equal(r.length, 5);
  const overlapped = r.filter(p => p.cols === 2);
  assert.equal(overlapped.length, 2); // оба созвона
});
