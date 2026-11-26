import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDay, canStepMonth, canStepWeek, cellChips, dayLabel, monthGrid, monthLabel, monthRange, stepMonth, stepWeek, toneOf, weekDays, weekLabel, weekLayout } from './month.js';

test('the grid is six Monday-first weeks covering the month', () => {
  const g = monthGrid('2026-11');
  assert.equal(g.length, 6);
  assert.deepEqual(g[0], ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(g[5][6], '2026-12-06');
  assert.equal(monthGrid('2027-02')[0][0], '2027-02-01');   // starts on a Monday
});

test('months step inside last / this / next month only', () => {
  assert.deepEqual(monthRange('2026-01-10'), ['2025-12', '2026-01', '2026-02']);
  assert.equal(stepMonth('2026-11', 1, '2026-11-26'), '2026-12');
  assert.equal(stepMonth('2026-12', 1, '2026-11-26'), '2026-12');
  assert.equal(stepMonth('2026-10', -1, '2026-11-26'), '2026-10');
  assert.ok(!canStepMonth('2026-12', 1, '2026-11-26'));
  assert.ok(canStepMonth('2026-12', -1, '2026-11-26'));
});

test('weeks step by seven days and stop at the range edges', () => {
  assert.deepEqual(weekDays('2026-11-26'), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(stepWeek('2026-11-26', 1, '2026-11-26'), '2026-11-30');
  assert.equal(stepWeek('2026-10-01', -1, '2026-11-26'), '2026-09-28');   // the week holding 1 Oct
  assert.ok(!canStepWeek('2026-09-28', -1, '2026-11-26'));
  assert.equal(stepWeek('2026-12-31', 1, '2026-11-26'), '2026-12-28');    // the week holding 31 Dec
  assert.ok(!canStepWeek('2026-12-28', 1, '2026-11-26'));
});

test('labels', () => {
  assert.equal(monthLabel('2026-11'), 'November 2026');
  assert.deepEqual(dayLabel('2026-11-26'), { weekday: 'Thursday', date: '26 November' });
  assert.equal(weekLabel('2026-11-26'), '23 – 29 November 2026');
  assert.equal(weekLabel('2026-12-02'), '30 November – 6 December 2026');
  assert.equal(weekLabel('2026-12-30'), '28 December 2026 – 3 January 2027');
});

test('cells: two chips and a count of the rest; one person colours a chip', () => {
  const e = (n) => Array.from({ length: n }, (_, i) => ({ title: String(i) }));
  assert.deepEqual(cellChips(e(2)), { chips: e(2), more: 0 });
  assert.deepEqual(cellChips(e(5)), { chips: e(2), more: 3 });
  assert.deepEqual(cellChips(undefined), { chips: [], more: 0 });
  assert.equal(toneOf({ who: ['sarina'] }), 'sarina');
  assert.equal(toneOf({ who: ['mariko', 'sarina'] }), 'shared');
  assert.equal(toneOf({ who: [] }), 'shared');
});

test('byDay keeps order and skips junk', () => {
  const m = byDay([{ date: '2026-11-26', title: 'a' }, null, { title: 'x' }, { date: '2026-11-26', title: 'b' }]);
  assert.deepEqual(m.get('2026-11-26').map((e) => e.title), ['a', 'b']);
  assert.equal(m.size, 1);
});

test('week layout: 7–21 unless stretched, default hour, minimum height, lanes for overlaps', () => {
  const days = weekDays('2026-11-26');
  const g = byDay([
    { date: '2026-11-23', start: null, allDay: true, title: 'Trip' },
    { date: '2026-11-23', start: '9:00', end: '10:30', title: 'A' },
    { date: '2026-11-23', start: '9:30', title: 'B' },
    { date: '2026-11-23', start: '11:00', end: '11:10', title: 'C' },
  ]);
  const w = weekLayout(days, g);
  assert.deepEqual([w.from, w.to], [7, 21]);
  const mon = w.days[0];
  assert.deepEqual(mon.allDay.map((e) => e.title), ['Trip']);
  assert.deepEqual(mon.timed.map((t) => [t.e.title, t.top, t.height, t.lane, t.lanes]), [
    ['A', 120, 90, 0, 2], ['B', 150, 60, 1, 2], ['C', 240, 30, 0, 1],
  ]);
  const early = weekLayout(days, byDay([{ date: '2026-11-24', start: '6:15', title: 'Run' }, { date: '2026-11-25', start: '21:30', end: '22:10', title: 'Late' }]));
  assert.deepEqual([early.from, early.to], [6, 23]);
  assert.equal(early.days[1].timed[0].top, 15);
});
