import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortTasks } from '../../../src/lib/sortTasks';
import type { Task } from '../../../src/types';

const withFixedDate = (iso: string, fn: () => void) => {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        return new RealDate(iso) as any;
      }
      return new RealDate(...args) as any;
    }
    static now() {
      return new RealDate(iso).getTime();
    }
  }
  (globalThis as any).Date = MockDate;
  try {
    fn();
  } finally {
    (globalThis as any).Date = RealDate;
  }
};

test('returns empty array when no tasks', () => {
  const result = sortTasks([]);
  assert.deepEqual(result, []);
});

test('orders tasks by overdue, today, future, and no-date groups', () => {
  withFixedDate('2026-05-18T10:00:00Z', () => {
    const tasks: Task[] = [
      { id: '1', name: 'future', date: '2026-05-20', time: '', done: false },
      { id: '2', name: 'today', date: '2026-05-18', time: '', done: false },
      { id: '3', name: 'overdue', date: '2026-05-10', time: '', done: false },
      { id: '4', name: 'no-date', date: '', time: '', done: false },
      { id: '5', name: 'done', date: '2026-05-01', time: '', done: true },
    ];

    const result = sortTasks(tasks);
    assert.equal(result[0].id, '3');
    assert.equal(result[1].id, '2');
    assert.equal(result[2].id, '1');
    assert.equal(result[3].id, '4');
    assert.equal(result[4].id, '5');
  });
});

test('orders today tasks by time when provided', () => {
  withFixedDate('2026-05-18T10:00:00Z', () => {
    const tasks: Task[] = [
      { id: '1', name: 'late', date: '2026-05-18', time: '18:00', done: false },
      { id: '2', name: 'early', date: '2026-05-18', time: '09:00', done: false },
      { id: '3', name: 'notimed', date: '2026-05-18', time: '', done: false },
    ];

    const result = sortTasks(tasks);
    assert.equal(result[0].id, '2');
    assert.equal(result[1].id, '1');
    assert.equal(result[2].id, '3');
  });
});
