import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARD_LEVEL, blame, describe, rms, speechApi, verdict } from './mictest.js';

test('blame: no device or an unopenable one is the Echo; a refusal is Silk', () => {
  assert.equal(blame('NotFoundError'), 'blocked-device');
  assert.equal(blame('NotReadableError'), 'blocked-device');
  assert.equal(blame('OverconstrainedError'), 'blocked-device');
  assert.equal(blame('NotAllowedError'), 'blocked-silk');
  assert.equal(blame('SecurityError'), 'blocked-silk');
  assert.equal(blame('TypeError'), 'blocked-silk');
});

test('rms: 128 is silence, full swing is ~1', () => {
  assert.equal(rms(new Uint8Array([128, 128, 128])), 0);
  assert.equal(rms(new Uint8Array([])), 0);
  assert.equal(rms(null), 0);
  assert.ok(Math.abs(rms(new Uint8Array([0, 256 - 1])) - 1) < 0.01);
});

test('verdict: no secure context or no API is Silk', () => {
  assert.equal(verdict({ secure: false }), 'blocked-silk');
  assert.equal(verdict({ secure: true, hasMediaDevices: false }), 'blocked-silk');
});

test('verdict: a granted track is "works" only once the level moved', () => {
  const ok = { secure: true, hasMediaDevices: true, gum: 'ok' };
  assert.equal(verdict(ok), 'inconclusive');
  assert.equal(verdict({ ...ok, peak: 0 }), 'granted-silent');
  assert.equal(verdict({ ...ok, peak: HEARD_LEVEL }), 'works');
});

test('verdict: a rejection is blamed by its error name', () => {
  const r = { secure: true, hasMediaDevices: true, gum: 'error' };
  assert.equal(verdict({ ...r, error: 'NotAllowedError' }), 'blocked-silk');
  assert.equal(verdict({ ...r, error: 'NotFoundError' }), 'blocked-device');
  assert.equal(verdict({ secure: true, hasMediaDevices: true, gum: null }), 'inconclusive');
});

test('describe: every verdict has a sentence', () => {
  for (const v of ['works', 'granted-silent', 'blocked-silk', 'blocked-device', 'inconclusive']) {
    assert.notEqual(describe(v), v);
  }
});

test('speechApi: prefers the standard name, then webkit, else none', () => {
  function F() {}
  assert.equal(speechApi({ SpeechRecognition: F, webkitSpeechRecognition: F }), 'SpeechRecognition');
  assert.equal(speechApi({ webkitSpeechRecognition: F }), 'webkitSpeechRecognition');
  assert.equal(speechApi({}), null);
});
