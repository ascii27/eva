import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWxFace, wxFace, wxFaces } from './wxface.js';

const now = { cond: 'sun', temp: 14, label: 'Sunny' };
const full = { now, hourly: [{ time: '10:00', cond: 'sun', temp: 16 }], daily: [{ day: 'Wed', cond: 'rain', high: 15, low: 8 }] };

test('a tap rotates now → hourly → daily → now', () => {
  assert.equal(nextWxFace('now', full), 'hourly');
  assert.equal(nextWxFace('hourly', full), 'daily');
  assert.equal(nextWxFace('daily', full), 'now');
});

test('a face with no data is skipped, not shown empty', () => {
  const old = { now, hourly: full.hourly };                // a panel from before `daily`
  assert.deepEqual(wxFaces(old), ['now', 'hourly']);
  assert.equal(nextWxFace('hourly', old), 'now');
  assert.deepEqual(wxFaces({ now, hourly: [], daily: [] }), ['now']);
  assert.equal(nextWxFace('now', { now }), 'now');
});

test('a panel that loses the shown face falls back to now', () => {
  assert.equal(wxFace('daily', { now, hourly: full.hourly }), 'now');
  assert.equal(wxFace('hourly', full), 'hourly');
  assert.equal(nextWxFace('daily', { now, hourly: full.hourly }), 'hourly');
});

test('no panel: nothing to rotate', () => {
  assert.deepEqual(wxFaces(null), []);
  assert.equal(nextWxFace('hourly', undefined), 'now');
});
