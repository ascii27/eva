import { describe, expect, it } from '@jest/globals';
import { HEARD, LIVE, tone } from '../earcon';

const RATE = 24000;

const peak = (pcm: Float32Array) => pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('tone', () => {
  it('produces the requested duration at the given rate', () => {
    expect(tone({ freq: 440, ms: 100, gain: 0.2 }, RATE)).toHaveLength(2400);
  });

  it('starts and ends at silence, so there is no click', () => {
    const pcm = tone({ freq: 440, ms: 100, gain: 0.2 }, RATE);
    expect(Math.abs(pcm[0])).toBeLessThan(1e-6);
    expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(1e-6);
  });

  it('never exceeds the requested gain, so it cannot clip', () => {
    const pcm = tone({ freq: 440, ms: 100, gain: 0.2 }, RATE);
    expect(peak(pcm)).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it('reaches close to full gain in the middle', () => {
    const pcm = tone({ freq: 440, ms: 100, gain: 0.2 }, RATE);
    expect(peak(pcm)).toBeGreaterThan(0.18);
  });

  it('glides when a second frequency is given', () => {
    const flat = tone({ freq: 440, ms: 100, gain: 0.2 }, RATE);
    const rising = tone({ freq: 440, toFreq: 880, ms: 100, gain: 0.2 }, RATE);
    expect(Array.from(rising)).not.toEqual(Array.from(flat));
    // Same envelope either way: a glide must not become louder.
    expect(peak(rising)).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it('returns nothing for a zero-length tone rather than dividing by zero', () => {
    const pcm = tone({ freq: 440, ms: 0, gain: 0.2 }, RATE);
    expect(pcm).toHaveLength(0);
  });

  it('survives a single-sample tone', () => {
    const pcm = tone({ freq: 440, ms: 1000 / RATE, gain: 0.2 }, RATE);
    expect(pcm).toHaveLength(1);
    expect(Number.isFinite(pcm[0])).toBe(true);
  });
});

describe('the two cues', () => {
  it('are both short enough to sit inside the wake handoff', () => {
    for (const spec of [HEARD, LIVE]) expect(spec.ms).toBeLessThanOrEqual(150);
  });

  it('are quiet — they play under a face that is about to listen', () => {
    for (const spec of [HEARD, LIVE]) expect(spec.gain).toBeLessThan(0.3);
  });

  it('are distinguishable: the second is higher than the first', () => {
    expect(LIVE.freq).toBeGreaterThan(HEARD.freq);
  });
});
