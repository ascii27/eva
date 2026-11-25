import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELOAD_AFTER_MS, RETRY_MAX_MS, STALE_MS, isStale, retryDelay, shouldReload } from './link.js';

test('retryDelay: starts at 3 s, doubles, caps at 60 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(retryDelay), [3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000]);
  assert.equal(retryDelay(1000), RETRY_MAX_MS, 'no overflow on a very long outage');
  assert.equal(retryDelay(-1), 3000);
});

test('isStale: only after a full STALE_MS of silence', () => {
  assert.equal(isStale(1000 + STALE_MS, 1000), false);
  assert.equal(isStale(1001 + STALE_MS, 1000), true);
});

test('shouldReload: never while connected', () => {
  assert.equal(shouldReload({ now: 1e9, offlineSince: null, busy: false }), false);
});

test('shouldReload: after RELOAD_AFTER_MS offline, not before', () => {
  assert.equal(shouldReload({ now: RELOAD_AFTER_MS - 1, offlineSince: 0, busy: false }), false);
  assert.equal(shouldReload({ now: RELOAD_AFTER_MS, offlineSince: 0, busy: false }), true);
});

test('shouldReload: held while someone is using the board', () => {
  assert.equal(shouldReload({ now: 10 * RELOAD_AFTER_MS, offlineSince: 0, busy: true }), false);
});
