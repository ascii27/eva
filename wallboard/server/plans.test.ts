import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, planList, prune, requestAdd, requestRemove, resolve, revivePlans, type EventSnapshot, type Plans } from './plans.ts';
import { apply, emptyState, planCheck, reviveState, view } from './state.ts';

const ev: EventSnapshot = {
  id: 'tc-1', title: 'D.League', url: 'https://tokyocheapo.com/events/d/', start: '2026-12-10', end: '2026-12-11',
  time: '18:30', until: '21:15', venue: 'Toyota Arena Tokyo', locality: 'Aomi', region: 'Suburban East Tokyo',
};
const T = '2026-11-25';
const ok = (r: Plans | null | string): Plans => { assert.equal(typeof r, 'object'); assert.ok(r); return r as Plans; };

test('add: snapshots the event for the chosen day, pending', () => {
  const p = ok(requestAdd({}, ev, '2026-12-11', T, 5))['tc-1'];
  assert.deepEqual(p, {
    id: 'tc-1', title: 'D.League', url: 'https://tokyocheapo.com/events/d/', day: '2026-12-11', time: '18:30', until: '21:15',
    venue: 'Toyota Arena Tokyo', place: 'Aomi, Suburban East Tokyo', want: 'add', status: 'pending', requestedAt: 5, updatedAt: 5,
  });
});

test('add: the day must be one the event is on, and not past', () => {
  assert.equal(requestAdd({}, ev, '2026-12-12', T, 0), 'the event is not on that day');
  assert.equal(requestAdd({}, { ...ev, start: '2026-11-01' }, '2026-11-24', T, 0), 'that day has passed');
  assert.equal(requestAdd({}, ev, 'soon', T, 0), 'day must be YYYY-MM-DD');
});

test('add twice is nothing new; a failed one can be retried; a new day is a move that keeps the ref', () => {
  const a = ok(requestAdd({}, ev, '2026-12-10', T, 1));
  assert.equal(requestAdd(a, ev, '2026-12-10', T, 2), null);
  const failed = ok(resolve(a, 'tc-1', { want: 'add', result: 'failed', note: 'Calendar unreachable' }, 3));
  assert.equal(failed['tc-1'].note, 'Calendar unreachable');
  const retry = ok(requestAdd(failed, ev, '2026-12-10', T, 4))['tc-1'];
  assert.equal(retry.status, 'pending');
  assert.equal(retry.note, undefined);
  const done = ok(resolve(a, 'tc-1', { want: 'add', result: 'done', ref: 'cal-9' }, 5));
  const moved = ok(requestAdd(done, ev, '2026-12-11', T, 6))['tc-1'];
  assert.deepEqual([moved.day, moved.status, moved.ref], ['2026-12-11', 'pending', 'cal-9']);
});

test('remove: pending until hermes says done, then gone; a failed add with nothing on the calendar just goes', () => {
  const done = ok(resolve(ok(requestAdd({}, ev, '2026-12-10', T, 1)), 'tc-1', { want: 'add', result: 'done', ref: 'cal-9' }, 2));
  const removing = ok(requestRemove(done, 'tc-1', 3));
  assert.deepEqual([removing['tc-1'].want, removing['tc-1'].status, removing['tc-1'].ref], ['remove', 'pending', 'cal-9']);
  assert.equal(requestRemove(removing, 'tc-1', 4), null);
  assert.deepEqual(ok(resolve(removing, 'tc-1', { want: 'remove', result: 'done' }, 5)), {});
  assert.equal(requestRemove({}, 'tc-1', 0), null);
  const failed = ok(resolve(ok(requestAdd({}, ev, '2026-12-10', T, 1)), 'tc-1', { want: 'add', result: 'failed', note: 'x' }, 2));
  assert.deepEqual(ok(requestRemove(failed, 'tc-1', 3)), {});
});

test('resolve: a report for a superseded want is stale; a repeated one is a no-op', () => {
  const adding = ok(requestAdd({}, ev, '2026-12-10', T, 1));
  const removing = ok(requestRemove(adding, 'tc-1', 2)); // changed their mind before hermes ran
  assert.equal(resolve(removing, 'tc-1', { want: 'add', result: 'done' }, 3), 'stale');
  const done = ok(resolve(adding, 'tc-1', { want: 'add', result: 'done' }, 3));
  assert.equal(resolve(done, 'tc-1', { want: 'add', result: 'done' }, 4), null);
  assert.equal(resolve(done, 'tc-1', { want: 'add', result: 'failed', note: 'x' }, 4), 'stale');
  assert.equal(resolve({}, 'tc-1', { want: 'add', result: 'done' }, 4), 'missing');
  assert.equal(resolve({}, 'tc-1', { want: 'remove', result: 'done' }, 4), null); // already gone
});

test('prune drops past days; list puts pending first, oldest request first', () => {
  let p = ok(requestAdd({}, ev, '2026-12-10', T, 9));
  p = ok(requestAdd(p, { ...ev, id: 'tc-2', start: '2026-11-25', end: '2026-11-25' }, '2026-11-25', T, 1));
  p = ok(requestAdd(p, { ...ev, id: 'tc-3', start: '2026-11-30', end: '2026-11-30' }, '2026-11-30', T, 5));
  p = ok(resolve(p, 'tc-3', { want: 'add', result: 'done' }, 6));
  assert.deepEqual(planList(p).map((x) => x.id), ['tc-2', 'tc-1', 'tc-3']);
  assert.deepEqual(Object.keys(prune(p, '2026-11-26')!).sort(), ['tc-1', 'tc-3']);
  assert.equal(prune(p, T), null);
});

test('report parsing: a failure needs a reason', () => {
  assert.equal(parseReport({ want: 'add', result: 'failed' }), 'a failed report needs a note saying why');
  assert.equal(parseReport({ want: 'move', result: 'done' }), 'want must be "add" or "remove"');
  assert.deepEqual(parseReport({ want: 'add', result: 'done', ref: 'x' }), { want: 'add', result: 'done', ref: 'x' });
});

test('state: plans survive a save and reload, show in the view, and old files get none', () => {
  const at = Date.parse('2026-11-25T03:00:00Z');
  const s = apply(emptyState('log-1'), { type: 'plan.add', event: ev, day: '2026-12-10', at })!;
  assert.equal(view(s, at).plans.length, 1);
  const back = reviveState(JSON.parse(JSON.stringify(s)), 'log-2');
  assert.deepEqual(back.plans, s.plans);
  assert.deepEqual(reviveState({ chores: [], panels: {} }, 'l').plans, {});
  assert.deepEqual(revivePlans({ 'tc-1': { id: 'tc-9' } }), {});
  assert.equal(planCheck(s, { type: 'plan.resolve', id: 'tc-1', report: { want: 'remove', result: 'done' }, at }), 'stale');
  // Past days disappear from the view even before the midnight prune runs.
  assert.equal(view(s, Date.parse('2026-12-11T03:00:00Z')).plans.length, 0);
});
