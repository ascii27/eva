import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANNOUNCE, ALARM, ALARM_MIN, RATE, render, wav, cueFor } from './chime.js';

const peak = (pcm) => pcm.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
const ms = (cue) => cue.reduce((n, c) => n + c.ms + (c.gap ?? 0), 0);

test('render: length matches the cue, never clips, starts and ends on silence', () => {
  for (const cue of [ANNOUNCE, ALARM]) {
    const pcm = render(cue);
    assert.ok(Math.abs(pcm.length - (ms(cue) / 1000) * RATE) <= cue.length, 'length');
    assert.ok(peak(pcm) <= Math.max(...cue.map((c) => c.gain)) + 1e-9, 'peak within gain');
    assert.ok(peak(pcm) > 0.1, 'audible');
    assert.ok(Math.abs(pcm[0]) < 1e-3 && Math.abs(pcm.at(-1)) < 1e-3, 'no click at the ends');
  }
});

test('render: every note ends on (near) silence, so the joins do not click', () => {
  for (const cue of [ANNOUNCE, ALARM]) {
    const pcm = render(cue);
    let at = 0;
    for (const c of cue) {
      const len = Math.round((c.ms / 1000) * RATE);
      assert.ok(Math.abs(pcm[at + len - 1]) < 1e-3, `note at ${at} ends quietly`);
      at += len + Math.round(((c.gap ?? 0) / 1000) * RATE);
    }
  }
});

test('the alarm is the longer, fuller cue', () => {
  assert.ok(ms(ALARM) > ms(ANNOUNCE) * 2);
});

test('wav: a valid 16-bit mono header and the samples after it', () => {
  const pcm = new Float32Array([0, 0.5, -0.5, 2]);
  const v = new DataView(wav(pcm, 8000));
  const tag = (o) => String.fromCharCode(...new Uint8Array(v.buffer, o, 4));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE'); assert.equal(tag(36), 'data');
  assert.equal(v.getUint16(22, true), 1);       // mono
  assert.equal(v.getUint32(24, true), 8000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(46, true), 16384);
  assert.equal(v.getInt16(50, true), 32767);    // clamped, not wrapped
});

test('cueFor: nothing when there is no card or it has passed', () => {
  assert.deepEqual(cueFor(null, new Set()), { cue: null, mark: [] });
  assert.equal(cueFor({ key: 'k', mins: 0 }, new Set()).cue, null);
});

test('cueFor: announce once when the card appears, then the alarm once at five minutes', () => {
  const played = new Set();
  const step = (mins) => {
    const r = cueFor({ key: 'k', mins }, played);
    r.mark.forEach((m) => played.add(m));
    return r.cue;
  };
  assert.equal(step(45), 'announce');
  assert.equal(step(44), null);
  assert.equal(step(ALARM_MIN + 1), null);
  assert.equal(step(ALARM_MIN), 'alarm');
  assert.equal(step(ALARM_MIN - 1), null);
  assert.equal(step(1), null);
});

test('cueFor: a card that first shows inside five minutes gets the alarm alone', () => {
  const played = new Set();
  const r = cueFor({ key: 'k', mins: 3 }, played);
  assert.equal(r.cue, 'alarm');
  r.mark.forEach((m) => played.add(m));
  assert.equal(cueFor({ key: 'k', mins: 2 }, played).cue, null);
});

test('cueFor: each event gets its own cues', () => {
  const played = new Set(['a:announce', 'a:alarm']);
  assert.equal(cueFor({ key: 'b', mins: 30 }, played).cue, 'announce');
});
