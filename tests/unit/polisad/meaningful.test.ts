import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMeaningful } from '../../../src/polisad/meaningful.ts';

test('noise: одиночное "привет"', () => {
  const { verdict } = scoreMeaningful([{ role: 'user', content: 'привет' }]);
  assert.equal(verdict, 'noise');
});

test('noise: ["привет", "как дела"]', () => {
  const { verdict } = scoreMeaningful([
    { role: 'user', content: 'привет' },
    { role: 'user', content: 'как дела' },
  ]);
  assert.equal(verdict, 'noise');
});

test('noise: одиночный "тест"', () => {
  const { verdict } = scoreMeaningful([{ role: 'user', content: 'тест' }]);
  assert.equal(verdict, 'noise');
});

test('meaningful: 3+ содержательных реплики суммарно >200 символов', () => {
  const { verdict } = scoreMeaningful([
    { role: 'user', content: 'Хочу запустить новый продукт в сфере EdTech, целевая аудитория — школьники 12–15 лет.' },
    { role: 'user', content: 'Основная проблема — мотивация к обучению, дети быстро теряют интерес к традиционным форматам.' },
    { role: 'user', content: 'Планирую сделать MVP к сентябрю, нужно определить ключевые фичи и партнёров для пилота.' },
  ]);
  assert.equal(verdict, 'meaningful');
});

test('не noise: диалог с tool_calls (создание задачи)', () => {
  const { verdict } = scoreMeaningful([
    { role: 'user', content: 'купи молоко' },
    { role: 'assistant', content: 'Записал задачу.', tool_calls: [{ id: '1', function: { name: 'create_task' } }] },
  ]);
  assert.notEqual(verdict, 'noise');
});

test('не noise: 2 коротких реплики с цифрой ("купить молоко", "завтра в 15:00")', () => {
  const { verdict } = scoreMeaningful([
    { role: 'user', content: 'купить молоко' },
    { role: 'user', content: 'завтра в 15:00' },
  ]);
  assert.notEqual(verdict, 'noise');
});

test('noise: пустой массив сообщений', () => {
  const { verdict } = scoreMeaningful([]);
  assert.equal(verdict, 'noise');
});

test('noise: только assistant-реплики без tool_calls', () => {
  const { verdict } = scoreMeaningful([
    { role: 'assistant', content: 'Привет! Чем могу помочь?' },
    { role: 'assistant', content: 'Жду вашего ответа.' },
  ]);
  assert.equal(verdict, 'noise');
});

test('страховка: одиночная развёрнутая реплика без цифр и имён — не noise', () => {
  const { verdict } = scoreMeaningful([
    { role: 'user', content: 'хочу запустить стартап и мне нужен план продаж на квартал' },
  ]);
  assert.notEqual(verdict, 'noise');
});
