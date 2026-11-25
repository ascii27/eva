import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hanamaruState, markCheered, metaLine, percent, rangeLabel, showWeek, toCheer } from './week.js';

const p = (who, done, due, extra = {}) => ({ who, done, due, left: 0, level: done >= due ? 'perfect' : 'great', hanamaru: null, chores: [], ...extra });
const review = (people, start = '2026-11-16') => ({ start, end: '2026-11-22', sunday: true, people });

test('shown all Sunday, or when pinned', () => {
  assert.equal(showWeek(0), true);
  assert.equal(showWeek(6), false);
  assert.equal(showWeek(1), false);
  assert.equal(showWeek(3, true), true);
});

test('range labels within and across a month', () => {
  assert.equal(rangeLabel('2026-11-16', '2026-11-22'), '16–22 Nov');
  assert.equal(rangeLabel('2026-11-30', '2026-12-06'), '30 Nov – 6 Dec');
});

test('the meta line invites, and a perfect week has nothing left', () => {
  assert.equal(metaLine(p('mariko', 12, 14, { left: 2 })), '12 of 14 done · 2 left today');
  assert.equal(metaLine(p('mariko', 12, 14)), '12 of 14 done');
  assert.equal(metaLine(p('mariko', 14, 14, { left: 1 })), '14 of 14 done');
});

test('bar percent and hanamaru state', () => {
  assert.equal(percent(p('a', 3, 4)), 75);
  assert.equal(percent(p('a', 0, 0)), 0);
  assert.equal(hanamaruState(p('a', 1, 1)), null);
  assert.equal(hanamaruState(p('a', 1, 1, { hanamaru: { due: 1, done: 1 } })), 'done');
  assert.equal(hanamaruState(p('a', 1, 1, { hanamaru: { due: 1, done: 0 } })), 'open');
});

test('each perfect week is cheered once, and a new week starts over', () => {
  const r = review([p('mariko', 7, 7), p('sarina', 5, 7)]);
  assert.deepEqual(toCheer(r, null), ['mariko']);
  const c = markCheered(r, null, ['mariko']);
  assert.deepEqual(toCheer(r, c), []);
  // Sarina finishes late on Sunday: only she is cheered.
  const late = review([p('mariko', 7, 7), p('sarina', 7, 7)]);
  assert.deepEqual(toCheer(late, c), ['sarina']);
  // Next week, last week's cheers don't count.
  assert.deepEqual(toCheer(review([p('mariko', 7, 7)], '2026-11-23'), c), ['mariko']);
  assert.deepEqual(toCheer(null, c), []);
});
