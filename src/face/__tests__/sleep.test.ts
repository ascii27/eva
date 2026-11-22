import { describe, expect, it } from '@jest/globals';
import { eyeGeo } from '../geometry';
import { ASLEEP_G, ASLEEP_SH, ASLEEP_SW, BLINK_MS, YAWN_MS } from '../constants';
import {
  ASLEEP_BRIGHTNESS,
  DIM_BRIGHTNESS,
  NIGHT_AWAKE_GRACE_MS,
  NIGHT_TALK_BRIGHTNESS,
  nightBrightness,
  nightStart,
  SLEEP_AFTER_MS,
  sleepPhase,
} from '../sleep';
import type { FaceMode } from '../types';

const NEVER = -9e9;
const at = (hm: string, day = 18) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2026, 10, day, h, m, 0, 0);
};
const min = 60_000;

describe('asleep pose (eyeGeo sleepK)', () => {
  it('sleepK 0 is exactly the awake face, in every mode', () => {
    const modes: FaceMode[] = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'confused', 'pleased'];
    for (const m of modes) {
      for (const t of [0, 1234, 9876]) {
        expect(eyeGeo(-1, t, m, NEVER, NEVER, 0)).toEqual(eyeGeo(-1, t, m, NEVER, NEVER));
      }
    }
  });

  it('sleepK 1 holds the yawn’s nearly-shut pose, centred, breathing', () => {
    for (const t of [0, 3100, 7777]) {
      const p = eyeGeo(1, t, 'idle', NEVER, NEVER, 1);
      expect(p.sh).toBeCloseTo(ASLEEP_SH);
      expect(p.sw).toBeCloseTo(ASLEEP_SW);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(0);
      expect(p.g).toBeGreaterThan(ASLEEP_G * 0.8);
      expect(p.g).toBeLessThan(ASLEEP_G * 1.0);
    }
  });

  it('matches the yawn at its hold, so it is the design’s shape', () => {
    // Mid-hold of a yawn on an otherwise still idle frame (t chosen so idle wander is 0).
    const yawn = eyeGeo(1, 0, 'idle', NEVER, -1000);
    expect(yawn.sh).toBeCloseTo(ASLEEP_SH);
    expect(yawn.sw).toBeCloseTo(ASLEEP_SW);
    expect(YAWN_MS).toBeGreaterThan(1500);
  });

  it('half asleep is between the two', () => {
    const awake = eyeGeo(1, 500, 'idle', NEVER, NEVER, 0);
    const half = eyeGeo(1, 500, 'idle', NEVER, NEVER, 0.5);
    expect(half.sh).toBeLessThan(awake.sh);
    expect(half.sh).toBeGreaterThan(ASLEEP_SH);
    expect(Math.abs(half.x)).toBeLessThan(Math.abs(awake.x) + 1e-9);
  });

  it('a blink while asleep cannot open her eyes', () => {
    const p = eyeGeo(1, 100, 'idle', 100 - BLINK_MS / 2, NEVER, 1);
    expect(p.sh).toBeCloseTo(ASLEEP_SH);
  });
});

describe('sleepPhase', () => {
  const longAgo = at('12:00').getTime();

  it('is always awake in the day', () => {
    for (const t of ['06:00', '12:00', '21:59']) expect(sleepPhase(at(t), false, longAgo)).toBe('awake');
  });

  it('dims at 22:00, and only looks asleep after ten quiet minutes of night', () => {
    expect(sleepPhase(at('22:00'), false, longAgo)).toBe('dim');
    expect(sleepPhase(at('22:09'), false, longAgo)).toBe('dim');
    expect(sleepPhase(at('22:10'), false, longAgo)).toBe('asleep');
    expect(sleepPhase(at('03:00', 19), false, longAgo)).toBe('asleep');
  });

  it('wakes at 06:00', () => {
    expect(sleepPhase(at('05:59', 19), false, longAgo)).toBe('asleep');
    expect(sleepPhase(at('06:00', 19), false, longAgo)).toBe('awake');
  });

  it('a conversation brightens her; after it she stays bright a minute, dims, then dozes off', () => {
    const now = at('23:30');
    expect(sleepPhase(now, true, longAgo)).toBe('awake');
    const ended = now.getTime();
    const after = (ms: number) => sleepPhase(new Date(ended + ms), false, ended);
    expect(after(NIGHT_AWAKE_GRACE_MS - 1)).toBe('awake');
    expect(after(NIGHT_AWAKE_GRACE_MS)).toBe('dim');
    expect(after(SLEEP_AFTER_MS - 1)).toBe('dim');
    expect(after(SLEEP_AFTER_MS)).toBe('asleep');
  });

  it('quiet only counts from 22:00, so an evening conversation never skips the dim phase', () => {
    const t = at('21:55').getTime();
    expect(sleepPhase(at('22:00'), false, t)).toBe('dim');
    expect(sleepPhase(new Date(t + SLEEP_AFTER_MS), false, t)).toBe('dim');   // 22:05
    expect(sleepPhase(at('22:10'), false, t)).toBe('asleep');
  });

  it('nightStart is the most recent 22:00', () => {
    expect(nightStart(at('23:15'))).toBe(at('22:00').getTime());
    expect(nightStart(at('02:00', 19))).toBe(at('22:00', 18).getTime());
  });
});

describe('nightBrightness', () => {
  it('steps down by phase', () => {
    expect(nightBrightness('awake', 0.8)).toBe(NIGHT_TALK_BRIGHTNESS);
    expect(nightBrightness('dim', 0.8)).toBe(DIM_BRIGHTNESS);
    expect(nightBrightness('asleep', 0.8)).toBe(ASLEEP_BRIGHTNESS);
  });

  it('never brightens a screen that was already darker in the day', () => {
    expect(nightBrightness('awake', 0.3)).toBe(0.3);
    expect(nightBrightness('dim', 0.05)).toBe(0.05);
  });
});
