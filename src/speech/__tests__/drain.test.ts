import { describe, expect, it } from '@jest/globals';
import { DRAIN_FLOOR_MS, drainBoundMs } from '../drain';

describe('drainBoundMs', () => {
  it('keeps the old 10s floor for a one-sentence consent question', () => {
    expect(drainBoundMs(0)).toBe(DRAIN_FLOOR_MS);
    expect(drainBoundMs(45)).toBe(DRAIN_FLOOR_MS + 6_000);
  });

  it('gives a long segment far more than 10s — the ASC-67 cut-off', () => {
    // ~600 chars is ~40s of Kokoro speech; the flat 10s bound gave up a
    // quarter of the way in, and the end of the reply was lost.
    expect(drainBoundMs(600)).toBeGreaterThan(40_000 + DRAIN_FLOOR_MS);
  });

  it('never goes below the floor', () => {
    expect(drainBoundMs(-5)).toBe(DRAIN_FLOOR_MS);
  });
});
