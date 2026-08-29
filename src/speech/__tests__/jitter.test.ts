import { describe, expect, it } from '@jest/globals';
import { drain, emptyJitter, offer, underrun } from '../jitter';

/** A chunk of `seconds` of audio; contents are irrelevant to the policy. */
const chunk = (n = 8) => new Float32Array(n);

/** Feed a sequence of durations, returning the state and everything flushed. */
function feed(seconds: number[], threshold: number) {
  let state = emptyJitter();
  const flushed: number[] = [];
  for (const s of seconds) {
    const r = offer(state, chunk(), s, threshold);
    state = r.state;
    flushed.push(r.flush.length);
  }
  return { state, flushed };
}

describe('offer', () => {
  it('holds everything until the lead is built, then releases it all at once', () => {
    const { state, flushed } = feed([0.3, 0.3, 0.3], 0.8);
    // 0.3 and 0.6 are short of the 0.8 lead; the third crosses it.
    expect(flushed).toEqual([0, 0, 3]);
    expect(state.buffering).toBe(false);
    expect(state.heldSeconds).toBe(0);
  });

  it('passes chunks straight through once playing', () => {
    const { flushed } = feed([1.0, 0.1, 0.1], 0.8);
    expect(flushed).toEqual([1, 1, 1]);
  });

  it('releases on the exact threshold, not just past it', () => {
    const { flushed } = feed([0.8], 0.8);
    expect(flushed).toEqual([1]);
  });

  it('keeps the chunks in the order they arrived', () => {
    let state = emptyJitter();
    const first = new Float32Array([1]);
    const second = new Float32Array([2]);
    state = offer(state, first, 0.2, 0.8).state;
    const r = offer(state, second, 0.9, 0.8);
    expect(r.flush).toEqual([first, second]);
  });
});

describe('underrun', () => {
  it('re-arms the lead, so a dry queue does not resume on a single chunk', () => {
    let { state } = feed([1.0], 0.8); // playing
    state = underrun(state);
    expect(state.buffering).toBe(true);
    const again = offer(state, chunk(), 0.2, 0.8);
    expect(again.flush).toHaveLength(0); // rebuilding the lead, not stuttering
    const enough = offer(again.state, chunk(), 0.7, 0.8);
    expect(enough.flush).toHaveLength(2);
  });
});

describe('drain', () => {
  it('releases a short utterance that never reached the threshold', () => {
    const { state } = feed([0.2], 0.8);
    const r = drain(state);
    expect(r.flush).toHaveLength(1);
    expect(r.state.heldSeconds).toBe(0);
  });

  it('is empty when everything has already been flushed', () => {
    const { state } = feed([1.0], 0.8);
    expect(drain(state).flush).toHaveLength(0);
  });

  it('stops buffering, so nothing can be held back after it', () => {
    const { state } = feed([0.2], 0.8);
    expect(drain(state).state.buffering).toBe(false);
  });
});
