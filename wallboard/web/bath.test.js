import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollBath, other } from './bath.js';

test('alternates every night, and the history records who went first', () => {
  let b = { date: '2026-11-18', tonight: 'sarina', history: ['mariko'] };
  b = rollBath(b, '2026-11-19');
  assert.deepEqual(b, { date: '2026-11-19', tonight: 'mariko', history: ['mariko', 'sarina'] });
  b = rollBath(b, '2026-11-20');
  assert.deepEqual(b, { date: '2026-11-20', tonight: 'sarina', history: ['mariko', 'sarina', 'mariko'] });
});

test('the same day is a no-op, however often it is called', () => {
  const b = { date: '2026-11-18', tonight: 'mariko', history: ['sarina'] };
  assert.deepEqual(rollBath(rollBath(b, '2026-11-18'), '2026-11-18'), b);
});

test('a swap tonight carries: tomorrow alternates from who actually went first', () => {
  let b = { date: '2026-11-18', tonight: 'sarina', history: [] };
  b = { ...b, tonight: other(b.tonight) };          // Swap: Mariko first tonight
  b = rollBath(b, '2026-11-19');
  assert.equal(b.tonight, 'sarina');
  assert.deepEqual(b.history, ['mariko']);
});

test('days the board was off still count', () => {
  const b = rollBath({ date: '2026-11-18', tonight: 'sarina', history: [] }, '2026-11-21');
  assert.equal(b.tonight, 'mariko');                // 3 nights on: S, M, S went → M
  assert.deepEqual(b.history, ['sarina', 'mariko', 'sarina']);
});

test('a long gap keeps the parity and only the last nights of history', () => {
  for (const gap of [6, 7, 30, 31, 365]) {
    const start = { date: '2026-01-01', tonight: 'sarina', history: [] };
    const today = new Date(Date.UTC(2026, 0, 1 + gap)).toISOString().slice(0, 10);
    const b = rollBath(start, today);
    assert.equal(b.tonight, gap % 2 ? 'mariko' : 'sarina', `gap ${gap}`);
    assert.equal(b.history.length, 5);
    assert.equal(b.history.at(-1), other(b.tonight), 'last night was the other girl');
    b.history.forEach((id, i, a) => i && assert.notEqual(id, a[i - 1], 'history alternates'));
  }
});

test('state saved before rotation existed is adopted as today, unchanged', () => {
  const b = rollBath({ tonight: 'mariko', history: ['sarina', 'mariko', 'sarina'] }, '2026-11-18');
  assert.deepEqual(b, { date: '2026-11-18', tonight: 'mariko', history: ['sarina', 'mariko', 'sarina'] });
});

test('a clock that went backwards changes nothing', () => {
  const b = { date: '2026-11-18', tonight: 'mariko', history: [] };
  assert.deepEqual(rollBath(b, '2026-11-17'), b);
});
