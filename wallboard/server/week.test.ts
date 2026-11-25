import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, emptyState, type BoardState, type ChoreDef } from './state.ts';
import { isHanamaru, levelOf, occurrences, weekOf, weekReview } from './week.ts';

/** Noon in Tokyo on the given day. */
const D = (iso: string) => Date.parse(iso + 'T03:00:00Z');
/** 23:30 in Tokyo on the given day: the last half hour of a Sunday. */
const LATE = (iso: string) => Date.parse(iso + 'T14:30:00Z');

// 2026-11-16 is a Monday; 2026-11-22 the Sunday after it.
const dishes: ChoreDef = { id: 'dishes', title: 'Dishes', who: 'mariko', icon: 'dishes', amount: 100, schedule: { every: 1, unit: 'day', start: '2026-11-16' } };
const hanamaru: ChoreDef = { id: 'hm', title: 'Hanamaru homework', who: 'mariko', icon: null, amount: 0, schedule: { every: 1, unit: 'week', start: '2026-11-21' } };
const bed: ChoreDef = { id: 'bed', title: 'Make bed', who: 'sarina', icon: 'bed', amount: 100, schedule: { every: 2, unit: 'day', start: '2026-11-16' } };
const anyone: ChoreDef = { id: 'plants', title: 'Plants', who: null, icon: 'plants', amount: 0, schedule: { every: 1, unit: 'day', start: '2026-11-16' } };

const board = (defs: ChoreDef[], at = D('2026-11-16')): BoardState =>
  apply(emptyState('log-w'), { type: 'chores.replace', chores: defs, at })!;
const tick = (s: BoardState, id: string, at: number) =>
  apply(s, { type: 'chore.set', id, done: true, at, eventId: `ev-${id}-${at}` }) ?? s;
const untick = (s: BoardState, id: string, at: number) =>
  apply(s, { type: 'chore.set', id, done: false, at, eventId: `un-${id}-${at}` }) ?? s;
const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, from + i)).toISOString().slice(0, 10));

test('the week runs Monday to Sunday, whatever day it is asked from', () => {
  assert.deepEqual(weekOf('2026-11-16'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(weekOf('2026-11-19'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(weekOf('2026-11-22'), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(weekOf('2026-11-23'), { start: '2026-11-23', end: '2026-11-29' });
  assert.deepEqual(weekOf('2026-12-31'), { start: '2026-12-28', end: '2027-01-03' });
});

test('occurrences count a schedule inside the week, from its start if that is mid-week', () => {
  assert.equal(occurrences(dishes.schedule, '2026-11-16', '2026-11-22'), 7);
  assert.equal(occurrences(bed.schedule, '2026-11-16', '2026-11-22'), 4);       // 16, 18, 20, 22
  assert.equal(occurrences(hanamaru.schedule, '2026-11-16', '2026-11-22'), 1);  // Saturday
  assert.equal(occurrences({ every: 1, unit: 'day', start: '2026-11-20' }, '2026-11-16', '2026-11-22'), 3);
  assert.equal(occurrences({ every: 1, unit: 'week', start: '2026-11-30' }, '2026-11-16', '2026-11-22'), 0);
  assert.equal(occurrences({ every: 2, unit: 'week', start: '2026-11-09' }, '2026-11-16', '2026-11-22'), 0);
});

test('levels grade the week instead of all or nothing', () => {
  assert.equal(levelOf(7, 7), 'perfect');
  assert.equal(levelOf(6, 7), 'great');
  assert.equal(levelOf(3, 7), 'good');
  assert.equal(levelOf(1, 7), 'started');
  assert.equal(levelOf(0, 7), 'none');
  assert.equal(levelOf(0, 0), 'none');
});

test('hanamaru homework is found by title (either script) or icon', () => {
  assert.ok(isHanamaru({ title: 'Hanamaru homework', icon: null }));
  assert.ok(isHanamaru({ title: 'はなまる', icon: null }));
  assert.ok(isHanamaru({ title: 'Homework', icon: 'hanamaru' }));
  assert.ok(!isHanamaru({ title: 'Dishes', icon: 'dishes' }));
});

test('a perfect week, finished in the last minutes of Sunday', () => {
  let s = board([dishes, hanamaru]);
  for (const d of days(16, 6)) s = tick(s, 'dishes', D(d));
  s = tick(s, 'hm', D('2026-11-21'));
  let r = weekReview(s, D('2026-11-22'));
  assert.equal(r.sunday, true);
  const [m] = r.people;
  assert.deepEqual([m.who, m.done, m.due, m.left, m.level], ['mariko', 7, 8, 1, 'great']);
  assert.deepEqual(m.hanamaru, { due: 1, done: 1 });

  s = tick(s, 'dishes', LATE('2026-11-22'));
  r = weekReview(s, LATE('2026-11-22'));
  assert.deepEqual([r.people[0].done, r.people[0].due, r.people[0].left, r.people[0].level], [8, 8, 0, 'perfect']);
});

test('hanamaru not done is reported on its own, and still open on Sunday', () => {
  let s = board([dishes, hanamaru]);
  for (const d of days(16, 7)) s = tick(s, 'dishes', D(d));
  const [m] = weekReview(s, D('2026-11-22')).people;
  assert.deepEqual(m.hanamaru, { due: 1, done: 0 });
  assert.equal(m.level, 'great');
  assert.equal(m.left, 1);                  // Saturday's homework carried over: still time
});

test('undone ticks do not count, and last week does not leak in', () => {
  let s = board([dishes], D('2026-11-09'));
  s = tick(s, 'dishes', D('2026-11-15'));   // last Sunday
  s = tick(s, 'dishes', D('2026-11-16'));
  s = tick(s, 'dishes', D('2026-11-17'));
  s = untick(s, 'dishes', D('2026-11-17'));
  const [m] = weekReview(s, D('2026-11-18')).people;
  assert.equal(m.done, 1);
  assert.equal(m.due, 7);
  assert.equal(weekReview(s, D('2026-11-18')).sunday, false);
});

test('per person, chores for nobody in particular left out, a chore with nothing due this week skipped', () => {
  const later: ChoreDef = { id: 'later', title: 'Windows', who: 'sarina', icon: 'windows', amount: 100, schedule: { every: 1, unit: 'week', start: '2026-12-01' } };
  let s = board([dishes, bed, anyone, later]);
  s = tick(s, 'bed', D('2026-11-16'));
  const r = weekReview(s, D('2026-11-22'));
  assert.deepEqual(r.people.map((p) => p.who), ['mariko', 'sarina']);
  const sa = r.people[1];
  assert.deepEqual(sa.chores.map((c) => c.id), ['bed']);
  assert.equal(sa.hanamaru, null);
  assert.deepEqual([sa.done, sa.due, sa.level], [1, 4, 'started']);
});

test('catching up on an overdue chore with nothing due this week still shows', () => {
  const fortnight: ChoreDef = { id: 'tub', title: 'Tub', who: 'sarina', icon: 'tub-clean', amount: 100, schedule: { every: 2, unit: 'week', start: '2026-11-09' } };
  let s = board([fortnight], D('2026-11-09'));
  s = tick(s, 'tub', D('2026-11-17'));      // due the 9th, done a week late
  const [sa] = weekReview(s, D('2026-11-22')).people;
  assert.deepEqual([sa.done, sa.due, sa.level], [1, 1, 'perfect']);
});
