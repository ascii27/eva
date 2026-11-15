import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, emptyState, parseChores, reviveState, type BoardState } from './state.ts';

const withChores = (): BoardState =>
  apply(emptyState(), {
    type: 'chores.replace',
    at: 1,
    chores: [
      { id: 'dishes', title: 'Dishes', who: 'kid-a', icon: null },
      { id: 'trash', title: 'Trash', who: null, icon: null },
    ],
  })!;

test('set marks done with a timestamp, and setting it back is the undo', () => {
  const a = apply(withChores(), { type: 'chore.set', id: 'dishes', done: true, at: 100 })!;
  assert.deepEqual(a.chores[0], { id: 'dishes', title: 'Dishes', who: 'kid-a', icon: null, done: true, doneAt: 100 });
  const b = apply(a, { type: 'chore.set', id: 'dishes', done: false, at: 200 })!;
  assert.equal(b.chores[0].done, false);
  assert.equal(b.chores[0].doneAt, null);
  assert.equal(b.version, a.version + 1);
});

test('setting a chore to the state it already has is a no-op, so a repeated undo cannot flip it', () => {
  const a = apply(withChores(), { type: 'chore.set', id: 'dishes', done: true, at: 100 })!;
  assert.equal(apply(a, { type: 'chore.set', id: 'dishes', done: true, at: 101 }), null);
});

test('setting an unknown chore is a no-op, not an error', () => {
  assert.equal(apply(withChores(), { type: 'chore.set', id: 'nope', done: true, at: 1 }), null);
});

test('replacing the list keeps done-ness for chores that survive it', () => {
  const ticked = apply(withChores(), { type: 'chore.set', id: 'trash', done: true, at: 50 })!;
  const next = apply(ticked, {
    type: 'chores.replace',
    at: 60,
    chores: [
      { id: 'trash', title: 'Take out trash', who: null, icon: null },
      { id: 'bed', title: 'Make bed', who: 'kid-b', icon: 'bed' },
    ],
  })!;
  assert.deepEqual(
    next.chores.map((c) => [c.id, c.title, c.done, c.doneAt]),
    [
      ['trash', 'Take out trash', true, 50],
      ['bed', 'Make bed', false, null],
    ],
  );
});

test('a panel set to empty data is present; a cleared panel is absent', () => {
  const s = apply(emptyState(), { type: 'panel.set', name: 'schedule', data: [], at: 5 })!;
  assert.deepEqual(s.panels.schedule, { data: [], updatedAt: 5 });
  const cleared = apply(s, { type: 'panel.clear', name: 'schedule' })!;
  assert.equal('schedule' in cleared.panels, false);
  assert.equal(apply(cleared, { type: 'panel.clear', name: 'schedule' }), null);
});

test('parseChores rejects malformed input with a usable message', () => {
  assert.match(parseChores({}) as string, /expected/);
  assert.match(parseChores({ chores: [{ id: 'a b', title: 'x' }] }) as string, /id: invalid/);
  assert.match(parseChores({ chores: [{ id: 'a', title: ' ' }] }) as string, /title/);
  assert.match(parseChores({ chores: [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }] }) as string, /duplicate/);
  assert.deepEqual(parseChores({ chores: [{ id: 'a', title: ' Dishes ' }] }), [{ id: 'a', title: 'Dishes', who: null, icon: null }]);
});

test('reviveState falls back to empty on a corrupt file', () => {
  assert.deepEqual(reviveState(null), emptyState());
  assert.deepEqual(reviveState({ chores: 'x' }), emptyState());
});

test('reviveState fills in fields an older file predates', () => {
  const s = reviveState({ version: 3, chores: [{ id: 'a', title: 'A', done: false, doneAt: null }], panels: {} });
  assert.equal(s.chores[0].icon, null);
  assert.equal(s.chores[0].who, null);
});

test('a pushed done wins and keeps its doneAt until it changes; omitted done keeps the tick', () => {
  let s = apply(emptyState(), { type: 'chores.replace', chores: [{ id: 'a', title: 'A', who: null, icon: null }], at: 1 })!;
  s = apply(s, { type: 'chores.replace', chores: [{ id: 'a', title: 'A', who: null, icon: null, done: true }], at: 2 })!;
  assert.deepEqual([s.chores[0].done, s.chores[0].doneAt], [true, 2]);
  s = apply(s, { type: 'chores.replace', chores: [{ id: 'a', title: 'A', who: null, icon: null, done: true }], at: 3 })!;
  assert.equal(s.chores[0].doneAt, 2);
  s = apply(s, { type: 'chores.replace', chores: [{ id: 'a', title: 'A', who: null, icon: null }], at: 4 })!;
  assert.equal(s.chores[0].done, true);
  assert.ok(!('done' in (parseChores({ chores: [{ id: 'a', title: 'A' }] }) as object[])[0]));
  s = apply(s, { type: 'chores.replace', chores: [{ id: 'a', title: 'A', who: null, icon: null, done: false }], at: 5 })!;
  assert.deepEqual([s.chores[0].done, s.chores[0].doneAt], [false, null]);
  assert.match(parseChores({ chores: [{ id: 'a', title: 'A', done: 'yes' }] }) as string, /done/);
});
