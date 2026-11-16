import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityAfter,
  apply,
  balances,
  emptyState,
  parseChores,
  reviveState,
  view,
  type BoardState,
  type ChoreDef,
} from './state.ts';

/** Noon in Tokyo on the given day, so the tests never sit near midnight. */
const D = (iso: string) => Date.parse(iso + 'T03:00:00Z');

const dishes: ChoreDef = {
  id: 'dishes',
  title: 'Dishes',
  who: 'mariko',
  icon: null,
  amount: 100,
  schedule: { every: 1, unit: 'day', start: '2026-11-16' },
};
const bath: ChoreDef = {
  id: 'bath',
  title: 'Bath',
  who: 'sarina',
  icon: 'bath',
  amount: 100,
  schedule: { every: 2, unit: 'day', start: '2026-11-15' },
};

/**
 * Steady state on the 16th: bath was done on the 15th (outside this log), so it
 * is next due on the 17th. Pushed fresh it would sit at its start, overdue.
 */
const twoChores = (): BoardState => {
  const s = apply(emptyState('log-t'), { type: 'chores.replace', chores: [dishes, bath], at: D('2026-11-16') })!;
  return { ...s, chores: [s.chores[0], { ...s.chores[1], nextDue: '2026-11-17' }] };
};

const tick = (s: BoardState, id: string, at: number, eventId = `ev-${id}-${at}`) =>
  apply(s, { type: 'chore.set', id, done: true, at, eventId });
const untick = (s: BoardState, id: string, at: number, eventId = `ev-un-${id}-${at}`) =>
  apply(s, { type: 'chore.set', id, done: false, at, eventId });
const pay = (s: BoardState, eventId: string, who: string, amount: number, at = D('2026-11-16')) =>
  apply(s, { type: 'payment', eventId, who, amount, source: 'board', note: null, at });
const shown = (s: BoardState, at: number) => view(s, at).chores.map((c) => [c.id, c.done]);

test("tick records a done event worth the chore's amount and hides nothing until midnight", () => {
  const s = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  assert.equal(s.log.length, 1);
  const [e] = s.log;
  assert.equal(e.type, 'done');
  assert.equal(e.seq, 1);
  assert.equal(e.delta, 100);
  assert.equal(e.who, 'mariko');
  assert.equal(e.type === 'done' && e.amount, 100);
  assert.equal(s.seq, 1);
  assert.deepEqual(shown(s, D('2026-11-16')), [['dishes', true]]);
  assert.deepEqual(shown(s, D('2026-11-17')), [['dishes', false], ['bath', false]]);
});

test('the day turns at Tokyo midnight, not UTC', () => {
  const lastMinute = Date.parse('2026-11-16T14:59:00Z'); // 23:59 Tokyo on the 16th
  const firstMinute = Date.parse('2026-11-16T15:01:00Z'); // 00:01 Tokyo on the 17th
  const s = tick(twoChores(), 'dishes', lastMinute)!;
  assert.equal(s.chores[0].doneOn, '2026-11-16');
  assert.equal(s.chores[0].nextDue, '2026-11-17');
  assert.deepEqual(view(s, firstMinute).chores.find((c) => c.id === 'dishes')?.done, false);
  assert.equal(untick(s, 'dishes', firstMinute), null);
});

test('bath not due on its off day', () => {
  assert.deepEqual(shown(twoChores(), D('2026-11-16')), [['dishes', false]]);
});

test('an overdue chore carries over until done', () => {
  assert.deepEqual(shown(twoChores(), D('2026-11-20')), [['dishes', false], ['bath', false]]);
  const s = tick(twoChores(), 'bath', D('2026-11-20'))!;
  // Ticked on the 20th: the next occurrence strictly after it (15 + 2k) is the 21st.
  assert.equal(s.chores[1].nextDue, '2026-11-21');
  assert.deepEqual(shown(s, D('2026-11-21')), [['dishes', false], ['bath', false]]);
});

test('undo the same day appends undone and restores due', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  const s = untick(t, 'dishes', D('2026-11-16'))!;
  assert.deepEqual(s.log.map((e) => e.type), ['done', 'undone']);
  const [done, undone] = s.log;
  assert.equal(undone.type === 'undone' && undone.cancels, done.id);
  assert.equal(undone.delta, -100);
  assert.equal(undone.seq, 2);
  assert.equal(balances(s).mariko.owed, 0);
  assert.equal(balances(s).mariko.earned, 0);
  assert.deepEqual(shown(s, D('2026-11-16')), [['dishes', false]]);
  assert.deepEqual(s.chores[0], { ...dishes, nextDue: '2026-11-16', doneOn: null, prevDue: null, doneEvent: null });
});

test('undo after midnight is a no-op', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  assert.equal(untick(t, 'dishes', D('2026-11-17')), null);
});

test('ticking a chore not due is a no-op, and so is ticking twice or an unknown id', () => {
  assert.equal(tick(twoChores(), 'bath', D('2026-11-16')), null);
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  assert.equal(tick(t, 'dishes', D('2026-11-16'), 'ev-other'), null);
  assert.equal(tick(twoChores(), 'nope', D('2026-11-16')), null);
  assert.equal(untick(twoChores(), 'dishes', D('2026-11-16')), null);
});

test('amount is snapshotted', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  const s = apply(t, { type: 'chores.replace', chores: [{ ...dishes, amount: 200 }, bath], at: D('2026-11-16') })!;
  assert.equal(s.chores[0].amount, 200);
  assert.equal(balances(s).mariko.earned, 100);
});

test('payment is idempotent on its id', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  const p = pay(t, 'pay-1', 'mariko', 100)!;
  assert.equal(pay(p, 'pay-1', 'mariko', 100), null);
  assert.deepEqual(balances(p).mariko, { earned: 100, paid: 100, owed: 0, lastPaidAt: D('2026-11-16') });
  const e = p.log[1];
  assert.equal(e.type === 'payment' && e.source, 'board');
  assert.equal(e.delta, -100);
});

test('a negative payment is an opening-balance credit and does not count as last paid', () => {
  const p = pay(twoChores(), 'open-1', 'sarina', -500)!;
  assert.deepEqual(balances(p).sarina, { earned: 0, paid: -500, owed: 500, lastPaidAt: null });
  assert.equal(pay(twoChores(), 'zero', 'sarina', 0), null);
});

test('cancel only cancels a payment, once', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'), 'ev-done')!;
  assert.equal(apply(t, { type: 'cancel', eventId: 'c-0', cancels: 'ev-done', at: D('2026-11-16') }), null);
  const p = pay(t, 'pay-1', 'mariko', 100, D('2026-11-16'))!;
  assert.equal(balances(p).mariko.owed, 0);
  const c = apply(p, { type: 'cancel', eventId: 'c-1', cancels: 'pay-1', at: D('2026-11-17') })!;
  assert.deepEqual(balances(c).mariko, { earned: 100, paid: 0, owed: 100, lastPaidAt: null });
  const undone = c.log[2];
  assert.deepEqual(
    [undone.type, undone.who, undone.delta, undone.type === 'undone' && undone.choreId],
    ['undone', 'mariko', 100, null],
  );
  assert.equal(apply(c, { type: 'cancel', eventId: 'c-2', cancels: 'pay-1', at: D('2026-11-17') }), null);
  assert.equal(apply(c, { type: 'cancel', eventId: 'c-3', cancels: 'nope', at: D('2026-11-17') }), null);
});

test('owed equals the sum of every delta', () => {
  let s = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  s = tick(s, 'dishes', D('2026-11-17'))!;
  s = untick(s, 'dishes', D('2026-11-17'))!;
  s = pay(s, 'p1', 'mariko', 50)!;
  s = pay(s, 'p2', 'mariko', 30)!;
  s = apply(s, { type: 'cancel', eventId: 'c1', cancels: 'p2', at: D('2026-11-17') })!;
  const sum = s.log.filter((e) => e.who === 'mariko').reduce((n, e) => n + e.delta, 0);
  assert.equal(balances(s).mariko.owed, sum);
  assert.equal(sum, 50);
});

test('every change bumps version; events take consecutive seqs', () => {
  const a = twoChores();
  const b = tick(a, 'dishes', D('2026-11-16'))!;
  const c = pay(b, 'p1', 'sarina', 10)!;
  assert.deepEqual([b.version, c.version], [a.version + 1, a.version + 2]);
  assert.deepEqual(c.log.map((e) => e.seq), [1, 2]);
});

test('replace keeps progress; a changed schedule re-anchors', () => {
  const t = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  const newbie: ChoreDef = { ...bath, id: 'bed', who: 'mariko', schedule: { every: 1, unit: 'week', start: '2026-11-01' } };
  const s = apply(t, {
    type: 'chores.replace',
    chores: [newbie, { ...dishes, schedule: { every: 2, unit: 'day', start: '2026-11-16' } }],
    at: D('2026-11-16'),
  })!;
  assert.deepEqual(s.chores.map((c) => c.id), ['bed', 'dishes']);
  const d = s.chores[1];
  assert.equal(d.doneOn, '2026-11-16');
  assert.equal(d.prevDue, '2026-11-16');
  assert.equal(d.nextDue, '2026-11-18');
  assert.equal(d.doneEvent, t.log[0].id);
  // A new chore starts at its start, even in the past: it shows as overdue.
  assert.equal(s.chores[0].nextDue, '2026-11-01');
  assert.deepEqual(shown(s, D('2026-11-16')), [['bed', false], ['dishes', true]]);
  // Removed chores leave the list; their events stay in the log.
  assert.equal(s.log.length, 1);
  // Undo after the re-anchor goes back to the re-anchored due day.
  const u = untick(s, 'dishes', D('2026-11-16'))!;
  assert.equal(u.chores[1].nextDue, '2026-11-16');
});

test('a changed schedule on a chore not done today re-anchors to its first day on or after today', () => {
  const s = apply(twoChores(), {
    type: 'chores.replace',
    chores: [dishes, { ...bath, schedule: { every: 1, unit: 'week', start: '2026-11-10' } }],
    at: D('2026-11-16'),
  })!;
  assert.equal(s.chores[1].nextDue, '2026-11-17');
  const same = apply(twoChores(), { type: 'chores.replace', chores: [dishes, { ...bath }], at: D('2026-11-20') })!;
  assert.equal(same.chores[1].nextDue, '2026-11-17'); // unchanged schedule: overdue stays overdue
});

test('parseChores rejects done and bad schedules', () => {
  const valid = { id: 'a', title: ' Dishes ', amount: 100, schedule: { every: 1, unit: 'day', start: '2026-11-16' } };
  assert.deepEqual(parseChores({ chores: [valid] }), [
    { id: 'a', title: 'Dishes', who: null, icon: null, amount: 100, schedule: { every: 1, unit: 'day', start: '2026-11-16' } },
  ]);
  assert.match(parseChores({ chores: [{ ...valid, done: true }] }) as string, /done/);
  assert.match(parseChores({ chores: [{ ...valid, done: false }] }) as string, /done/);
  assert.match(parseChores({ chores: [{ ...valid, amount: -1 }] }) as string, /amount/);
  assert.match(parseChores({ chores: [{ ...valid, amount: 1.5 }] }) as string, /amount/);
  assert.match(parseChores({ chores: [{ ...valid, amount: undefined }] }) as string, /amount/);
  assert.match(parseChores({ chores: [{ ...valid, schedule: undefined }] }) as string, /schedule/);
  assert.match(parseChores({ chores: [{ ...valid, schedule: { every: 0, unit: 'day', start: '2026-11-16' } }] }) as string, /schedule.*every/);
});

test('parseChores rejects malformed input with a usable message', () => {
  const ok = { amount: 0, schedule: { every: 1, unit: 'day', start: '2026-11-16' } };
  assert.match(parseChores({}) as string, /expected/);
  assert.match(parseChores({ chores: [{ ...ok, id: 'a b', title: 'x' }] }) as string, /id: invalid/);
  assert.match(parseChores({ chores: [{ ...ok, id: 'a', title: ' ' }] }) as string, /title/);
  assert.match(parseChores({ chores: [{ ...ok, id: 'a', title: 'x' }, { ...ok, id: 'a', title: 'y' }] }) as string, /duplicate/);
  assert.match(parseChores({ chores: [{ ...ok, id: 'a', title: 'x', who: 3 }] }) as string, /who/);
});

test('activityAfter returns events after a seq', () => {
  let s = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  s = untick(s, 'dishes', D('2026-11-16'))!;
  s = pay(s, 'p1', 'sarina', 100)!;
  const a = activityAfter(s, 1);
  assert.deepEqual(a.events.map((e) => e.seq), [2, 3]);
  assert.equal(a.logId, 'log-t');
  assert.equal(a.seq, 3);
  assert.deepEqual(activityAfter(s, 3).events, []);
});

test('view lists balances for everyone in the chores or the log', () => {
  const s = pay(twoChores(), 'p1', 'mom', 1)!;
  const zero = { earned: 0, paid: 0, owed: 0, lastPaidAt: null };
  const v = view(s, D('2026-11-16'));
  assert.deepEqual(v.balances.mariko, zero);
  assert.deepEqual(v.balances.sarina, zero);
  assert.equal(v.balances.mom.paid, 1);
  assert.equal(v.version, s.version);
  assert.deepEqual(v.chores[0], { id: 'dishes', title: 'Dishes', who: 'mariko', icon: null, amount: 100, done: false });
});

test('reviveState upgrades an old file', () => {
  const s = reviveState(
    {
      version: 7,
      chores: [{ id: 'x', title: 'X', who: null, icon: null, done: true, doneAt: 1 }],
      panels: { eva: { data: 'hi', updatedAt: 1 } },
    },
    'log-new',
  );
  assert.equal(s.logId, 'log-new');
  assert.deepEqual(s.chores, []);
  assert.deepEqual(s.log, []);
  assert.equal(s.seq, 0);
  assert.deepEqual(s.panels, { eva: { data: 'hi', updatedAt: 1 } });
  assert.equal(s.version, 7);
});

test('reviveState round-trips a current file and falls back to empty on a corrupt one', () => {
  let s = tick(twoChores(), 'dishes', D('2026-11-16'))!;
  s = pay(s, 'p1', 'mariko', 100)!;
  assert.deepEqual(reviveState(JSON.parse(JSON.stringify(s)), 'other'), s);
  assert.equal(reviveState({ ...s, seq: undefined }, 'other').seq, 2);
  assert.deepEqual(reviveState(null, 'log-x'), emptyState('log-x'));
  assert.deepEqual(reviveState({ chores: 'x' }, 'log-x'), emptyState('log-x'));
});

test('a panel set to empty data is present; a cleared panel is absent', () => {
  const s = apply(emptyState('log-t'), { type: 'panel.set', name: 'schedule', data: [], at: 5 })!;
  assert.deepEqual(s.panels.schedule, { data: [], updatedAt: 5 });
  const cleared = apply(s, { type: 'panel.clear', name: 'schedule' })!;
  assert.equal('schedule' in cleared.panels, false);
  assert.equal(apply(cleared, { type: 'panel.clear', name: 'schedule' }), null);
});
