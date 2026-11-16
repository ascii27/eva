import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstOnOrAfter, nextAfter, parseSchedule, tokyoDay } from './schedule.ts';

test('tokyoDay rolls over at 15:00 UTC', () => {
  assert.equal(tokyoDay(Date.parse('2026-11-16T14:59:00Z')), '2026-11-16');
  assert.equal(tokyoDay(Date.parse('2026-11-16T15:00:00Z')), '2026-11-17');
});
test('nextAfter: daily, every 2 days, weekly', () => {
  assert.equal(nextAfter({ every: 1, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-17'), '2026-11-19');
  assert.equal(nextAfter({ every: 1, unit: 'week', start: '2026-11-02' }, '2026-11-16'), '2026-11-23');
});
test('nextAfter skips past today for an overdue chore', () => {
  // due 11-03 every 2 days, ticked on 11-16 → 11-17, not 11-05
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-03' }, '2026-11-16'), '2026-11-17');
});
test('nextAfter before start is start', () => {
  assert.equal(nextAfter({ every: 1, unit: 'week', start: '2026-12-01' }, '2026-11-16'), '2026-12-01');
});
test('firstOnOrAfter includes today when today is an occurrence', () => {
  assert.equal(firstOnOrAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-17'), '2026-11-17');
  assert.equal(firstOnOrAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
});
test('month and year boundaries', () => {
  assert.equal(nextAfter({ every: 1, unit: 'day', start: '2026-01-01' }, '2026-12-31'), '2027-01-01');
});
test('parseSchedule rejects bad input', () => {
  assert.equal(typeof parseSchedule({ every: 0, unit: 'day', start: '2026-11-01' }), 'string');
  assert.equal(typeof parseSchedule({ every: 1, unit: 'month', start: '2026-11-01' }), 'string');
  assert.equal(typeof parseSchedule({ every: 1, unit: 'day', start: '2026-02-30' }), 'string');
  assert.deepEqual(parseSchedule({ every: 2, unit: 'week', start: '2026-11-02' }), { every: 2, unit: 'week', start: '2026-11-02' });
});
