import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comingUp, shownAt } from './comingup.js';

const today = Date.UTC(2026, 10, 16);   // 2026-11-16
const labels = (xs) => xs.map((x) => x.label);

const defaults = [
  { label: 'Sarina', kind: 'birthday', who: 'sarina', date: '2026-11-20' },
  { label: 'Thanksgiving', kind: 'thanksgiving', date: '2026-11-26' },
  { label: '音楽会', kind: 'recital', date: '2026-12-03' },
];

test('the defaults rotate on their own, nearest first, with day counts', () => {
  const c = comingUp(null, defaults, today);
  assert.deepEqual(labels(c), ['Sarina', 'Thanksgiving', '音楽会']);
  assert.deepEqual(c.map((x) => x.days), [4, 10, 17]);
});

test("Eva's push joins the rotation rather than replacing it", () => {
  const c = comingUp([{ id: 'g', label: 'Grandma', kind: 'visit', date: '2026-11-28' }], defaults, today);
  assert.deepEqual(labels(c), ['Sarina', 'Thanksgiving', 'Grandma', '音楽会']);
});

test('a default on the same day as a push, same kind or same label, is dropped; hers stays', () => {
  const pushed = [
    { id: 's', label: 'Sarina turns 9', kind: 'birthday', date: '2026-11-20' },   // same day + kind
    { id: 't', label: 'Thanksgiving', date: '2026-11-26' },                        // same day + label (no kind = visit)
  ];
  assert.deepEqual(labels(comingUp(pushed, defaults, today)), ['Sarina turns 9', 'Thanksgiving', '音楽会']);
  assert.equal(comingUp(pushed, defaults, today)[1].id, 't');
  // Same kind on another day is a different occasion.
  assert.equal(comingUp([{ label: 'Mariko', kind: 'birthday', date: '2026-12-01' }], defaults, today).length, 4);
});

test('an empty push still lets the defaults through; past and undated ones are dropped', () => {
  assert.deepEqual(labels(comingUp([], defaults, today)), ['Sarina', 'Thanksgiving', '音楽会']);
  assert.deepEqual(labels(comingUp([{ label: 'Old', date: '2026-11-01' }, { label: 'Bare', days: 3 }, { label: 'None' }], null, today)), ['Bare']);
  assert.deepEqual(comingUp(null, null, today), []);
});

test('shownAt wraps, and is null for nothing', () => {
  const l = ['a', 'b', 'c'];
  assert.deepEqual([0, 1, 2, 3, 7].map((n) => shownAt(l, n)), ['a', 'b', 'c', 'a', 'b']);
  assert.equal(shownAt([], 5), null);
});
