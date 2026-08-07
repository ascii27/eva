import { describe, expect, it } from '@jest/globals';
import {
  blinkFactor,
  clampCorners,
  EYE_CORNERS_BASE,
  EYE_CORNERS_PLEASED,
  eyeGeo,
  hexToRgba,
  isSleepyHour,
  uniformCorners,
  yawnFactor,
} from '../geometry';
import { BLINK_MS, EYE_H, YAWN_MS } from '../constants';
import type { FaceMode } from '../types';

const MODES: FaceMode[] = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'confused', 'pleased'];
const NO_EVENT = -9e9;

describe('blinkFactor', () => {
  it('is fully open outside the blink window', () => {
    expect(blinkFactor(1000, NO_EVENT)).toBe(1);
    expect(blinkFactor(1000, 1000 - BLINK_MS)).toBe(1);
    expect(blinkFactor(999, 1000)).toBe(1);
  });

  it('collapses to 5% at the blink midpoint and recovers', () => {
    expect(blinkFactor(1085, 1000)).toBeCloseTo(0.05, 5);
    expect(blinkFactor(1000, 1000)).toBeCloseTo(1, 5);
    expect(blinkFactor(1000 + BLINK_MS - 1, 1000)).toBeGreaterThan(0.9);
  });
});

describe('yawnFactor', () => {
  it('is null outside the yawn window', () => {
    expect(yawnFactor(0, NO_EVENT)).toBeNull();
    expect(yawnFactor(5000, 5000 - YAWN_MS)).toBeNull();
  });

  it('droops, holds nearly shut, overshoots, settles', () => {
    const start = yawnFactor(0, 0)!;
    expect(start.sh).toBeCloseTo(1, 5);
    const held = yawnFactor(1000, 0)!;
    expect(held.sh).toBeCloseTo(0.15, 5);
    const overshoot = yawnFactor(1900, 0)!;
    expect(overshoot.sh).toBeCloseTo(1.3, 5);
    const settle = yawnFactor(2399, 0)!;
    expect(settle.sh).toBeGreaterThan(0.99);
    expect(settle.sh).toBeLessThanOrEqual(1.01);
  });
});

describe('eyeGeo', () => {
  it('returns sane bounded values for every mode over time', () => {
    for (const mode of MODES) {
      for (let t = 0; t < 20000; t += 137) {
        for (const side of [-1, 1]) {
          const g = eyeGeo(side, t, mode, NO_EVENT, NO_EVENT);
          expect(g.sw).toBeGreaterThan(0.3);
          expect(g.sw).toBeLessThan(1.5);
          expect(g.sh).toBeGreaterThan(0.01);
          expect(g.sh).toBeLessThan(1.6);
          expect(Math.abs(g.x)).toBeLessThan(30);
          expect(Math.abs(g.y)).toBeLessThan(25);
          expect(g.g).toBeGreaterThan(0);
          expect(g.g).toBeLessThanOrEqual(2.1);
        }
      }
    }
  });

  it('confused is asymmetric: left droops down, right widens up', () => {
    const left = eyeGeo(-1, 500, 'confused', NO_EVENT, NO_EVENT);
    const right = eyeGeo(1, 500, 'confused', NO_EVENT, NO_EVENT);
    expect(left.sh).toBeCloseTo(0.5);
    expect(left.y).toBe(14);
    expect(right.sh).toBeCloseTo(1.14);
    expect(right.y).toBe(-6);
  });

  it('pleased squints with the smile-curve corners', () => {
    const g = eyeGeo(1, 0, 'pleased', NO_EVENT, NO_EVENT);
    expect(g.sh).toBeCloseTo(0.52);
    expect(g.corners).toBe(EYE_CORNERS_PLEASED);
    expect(g.corners.tl.y).toBeGreaterThan(g.corners.br.y);
  });

  it('uses base corners in idle and applies blink multiplicatively', () => {
    const open = eyeGeo(1, 5000, 'idle', NO_EVENT, NO_EVENT);
    expect(open.corners).toBe(EYE_CORNERS_BASE);
    const blinking = eyeGeo(1, 5085, 'idle', 5000, NO_EVENT);
    expect(blinking.sh).toBeCloseTo(open.sh * 0.05, 3);
  });

  it('alert is the widest, brightest state', () => {
    const g = eyeGeo(1, 123, 'alert', NO_EVENT, NO_EVENT);
    expect(g.sw).toBeCloseTo(1.24);
    expect(g.sh).toBeCloseTo(1.36);
    expect(g.g).toBe(2);
  });
});

describe('clampCorners', () => {
  it('leaves non-overlapping radii untouched', () => {
    const c = uniformCorners(9);
    expect(clampCorners(104, 132, c)).toBe(c);
  });

  it('scales down all radii when an edge overlaps (CSS rule)', () => {
    // pleased eye: left edge 118.8 + 16 = 134.8 > 132
    const f = 132 / (EYE_H * 0.9 + 16);
    expect(EYE_CORNERS_PLEASED.tl.y).toBeCloseTo(EYE_H * 0.9 * f, 3);
    expect(EYE_CORNERS_PLEASED.br.y).toBeCloseTo(16 * f, 3);
  });
});

describe('helpers', () => {
  it('isSleepyHour matches the design window (before 7, from 22)', () => {
    expect(isSleepyHour(3)).toBe(true);
    expect(isSleepyHour(6)).toBe(true);
    expect(isSleepyHour(7)).toBe(false);
    expect(isSleepyHour(12)).toBe(false);
    expect(isSleepyHour(21)).toBe(false);
    expect(isSleepyHour(22)).toBe(true);
    expect(isSleepyHour(23)).toBe(true);
  });

  it('hexToRgba expands 6- and 3-digit hex', () => {
    expect(hexToRgba('#7cf2c4', 0.55)).toBe('rgba(124,242,196,0.55)');
    expect(hexToRgba('#fff', 1)).toBe('rgba(255,255,255,1)');
  });
});
