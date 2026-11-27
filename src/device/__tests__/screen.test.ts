import { describe, expect, it } from '@jest/globals';
import { ASLEEP_BRIGHTNESS, DIM_BRIGHTNESS, NIGHT_TALK_BRIGHTNESS } from '../../face/sleep';
import {
  adjustLevel,
  brightnessReport,
  changeLog,
  describeChange,
  describeScreen,
  levelFromPercent,
  lightReport,
  manualActive,
  MIN_LEVEL,
  nextScheduleEdge,
  screenStatusLine,
  targetLevel,
} from '../screen';

const at = (h: number, m = 0) => new Date(2026, 10, 27, h, m);

describe('levelFromPercent', () => {
  it('turns a percent into a level, floored above black', () => {
    expect(levelFromPercent(30)).toBe(0.3);
    expect(levelFromPercent('45%')).toBe(0.45);
    expect(levelFromPercent(0)).toBe(MIN_LEVEL);
    expect(levelFromPercent(100)).toBe(1);
  });

  it('refuses anything that is not a percent', () => {
    expect(levelFromPercent(150)).toBeNull();
    expect(levelFromPercent(-1)).toBeNull();
    expect(levelFromPercent('bright')).toBeNull();
    expect(levelFromPercent(undefined)).toBeNull();
  });
});

describe('adjustLevel', () => {
  it('halves for dimmer, and never reaches black', () => {
    expect(adjustLevel(0.4, 'dimmer')).toBe(0.2);
    expect(adjustLevel(0.01, 'dimmer')).toBe(MIN_LEVEL);
  });

  it('brightens by at least 20 points, capped at full', () => {
    expect(adjustLevel(0.05, 'brighter')).toBeCloseTo(0.25);
    expect(adjustLevel(0.4, 'brighter')).toBe(0.8);
    expect(adjustLevel(0.9, 'brighter')).toBe(1);
  });
});

describe('nextScheduleEdge', () => {
  it('is 22:00 by day and 06:00 by night', () => {
    expect(nextScheduleEdge(at(14))).toBe(at(22).getTime());
    expect(nextScheduleEdge(at(23)).valueOf()).toBe(new Date(2026, 10, 28, 6).getTime());
    expect(nextScheduleEdge(at(3))).toBe(at(6).getTime());
  });

  it('is never now', () => {
    expect(nextScheduleEdge(at(22))).toBe(new Date(2026, 10, 28, 6).getTime());
    expect(nextScheduleEdge(at(6))).toBe(at(22).getTime());
  });
});

describe('targetLevel — a person against the schedule', () => {
  const now = at(23).getTime();
  const held = { level: 0.05, until: at(6).getTime() + 86_400_000 };

  it('leaves the day alone when nobody asked', () => {
    expect(targetLevel('awake', false, 0.7, null, now)).toBeNull();
  });

  it('follows the night phases when nobody asked', () => {
    expect(targetLevel('awake', true, 0.7, null, now)).toBe(NIGHT_TALK_BRIGHTNESS);
    expect(targetLevel('dim', true, 0.7, null, now)).toBe(DIM_BRIGHTNESS);
    expect(targetLevel('asleep', true, 0.7, null, now)).toBe(ASLEEP_BRIGHTNESS);
  });

  it('holds a requested level through talk and dim, so "dim the screen" stays dim', () => {
    expect(targetLevel('awake', true, 0.7, held, now)).toBe(0.05);
    // The night's own dim level is brighter than what was asked for.
    expect(targetLevel('dim', true, 0.7, held, now)).toBe(0.05);
  });

  it('holds a brighter request too, but asleep is always dark', () => {
    const bright = { level: 0.9, until: held.until };
    expect(targetLevel('dim', true, 0.7, bright, now)).toBe(0.9);
    expect(targetLevel('asleep', true, 0.7, bright, now)).toBe(ASLEEP_BRIGHTNESS);
    expect(targetLevel('asleep', true, 0.7, { level: 0.01, until: held.until }, now)).toBe(0.01);
  });

  it('applies by day while it holds', () => {
    expect(targetLevel('awake', false, 1, { level: 0.3, until: at(22).getTime() }, at(14).getTime())).toBe(0.3);
  });

  it('lapses at its edge, and the schedule takes over', () => {
    expect(manualActive(held, held.until)).toBe(false);
    expect(manualActive(held, held.until - 1)).toBe(true);
    expect(targetLevel('dim', true, 0.7, held, held.until)).toBe(DIM_BRIGHTNESS);
  });
});

describe('reporting', () => {
  const until = at(22).getTime();

  it('says before, after and how long it holds', () => {
    expect(describeChange({ before: 0.6, after: 0.3, until })).toBe(
      "The desk phone's screen was 60 percent and is now at 30 percent brightness. It stays there until ten at night, when the night schedule takes over, or until the face falls asleep.",
    );
    expect(describeChange({ before: null, after: 0.3, until: at(6).getTime() })).toMatch(/^The desk phone's screen is now at 30 percent.*six in the morning/);
    expect(describeChange({ before: 0.6, after: null, until })).toBe('The screen brightness could not be set.');
    expect(changeLog({ before: 0.6, after: 0.3, until })).toBe('60% → 30%');
  });

  it('reads the level, or says it cannot', () => {
    expect(describeScreen(0.42)).toBe("The desk phone's screen is at 42 percent brightness.");
    expect(describeScreen(null)).toMatch(/cannot/);
  });

  it('answers hermes in Slack for each kind of request', () => {
    expect(brightnessReport({ kind: 'read', level: 0.5 })).toBe(
      "Brightness reading you asked for: The desk phone's screen is at 50 percent brightness.",
    );
    expect(brightnessReport({ kind: 'set', change: { before: 0.6, after: 0.3, until } })).toMatch(/^Brightness changed as you asked: .*was 60 percent/);
    expect(brightnessReport({ kind: 'invalid' })).toMatch(/\[\[brightness N\]\]/);
    expect(lightReport({ reading: { lux: 3, band: 'dark', at: 0 } }, 0.1, 0)).toBe(
      "Light reading you asked for: The room at the desk is dark, about 3 lux, measured just now. The desk phone's screen is at 10 percent brightness.",
    );
    expect(lightReport({ error: 'the camera is in use right now.' }, null, 0)).toMatch(/could not measure the light: the camera is in use/);
  });

  it("gives the hermes brain the screen and the last light, and how to change it", () => {
    const line = screenStatusLine(0.4, { lux: 300, band: 'lit', at: 0 }, 120_000) as string;
    expect(line).toMatch(/40 percent brightness/);
    expect(line).toMatch(/measured 2 minutes ago/);
    expect(line).toMatch(/\[\[brightness N\]\]/);
    expect(screenStatusLine(0.4, null, 0)).not.toMatch(/lux/);
    expect(screenStatusLine(null, null, 0)).toBeNull();
  });
});
