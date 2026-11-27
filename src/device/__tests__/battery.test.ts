import { describe, expect, it } from '@jest/globals';
import {
  alertLine,
  batteryAlert,
  batteryLevel,
  batteryReport,
  deskStatusLine,
  chargeState,
  describeBattery,
  isPluggedIn,
  type BatteryReading,
} from '../battery';

const r = (level: number | null, state: BatteryReading['state'], lowPowerMode = false): BatteryReading => ({
  level,
  state,
  lowPowerMode,
});

describe('reading the native values', () => {
  it("maps expo-battery's enum", () => {
    expect([0, 1, 2, 3, 4, 9].map(chargeState)).toEqual([
      'unknown',
      'unplugged',
      'charging',
      'full',
      'not_charging',
      'unknown',
    ]);
  });

  it('treats the simulator\'s -1 as unknown, not empty', () => {
    expect(batteryLevel(-1)).toBeNull();
    expect(batteryLevel(NaN)).toBeNull();
    expect(batteryLevel(0)).toBe(0);
    expect(batteryLevel(0.42)).toBe(0.42);
  });

  it('counts a cable that is not charging as plugged in', () => {
    expect(isPluggedIn('not_charging')).toBe(true);
    expect(isPluggedIn('full')).toBe(true);
    expect(isPluggedIn('unplugged')).toBe(false);
    expect(isPluggedIn('unknown')).toBe(false);
  });
});

describe('describeBattery', () => {
  it('says level and charging state for the ear', () => {
    expect(describeBattery(r(0.823, 'charging'))).toBe("The desk phone's battery is at 82 percent and charging.");
    expect(describeBattery(r(0.4, 'unplugged'))).toBe("The desk phone's battery is at 40 percent and not plugged in.");
    expect(describeBattery(r(0.8, 'not_charging'))).toBe(
      "The desk phone's battery is at 80 percent and plugged in but not charging.",
    );
  });

  it('never says a percent sign', () => {
    expect(describeBattery(r(0.5, 'charging'))).not.toContain('%');
  });

  it('says fully charged without a number', () => {
    expect(describeBattery(r(1, 'full'))).toBe('The desk phone is fully charged and plugged in.');
  });

  it('admits an unknown level rather than saying zero', () => {
    expect(describeBattery(r(null, 'unknown'))).toBe('The desk phone cannot read its battery right now.');
    expect(describeBattery(r(null, 'charging'))).toBe(
      'The desk phone cannot read its battery level, but it is charging.',
    );
    expect(describeBattery(r(0.3, 'unknown'))).toBe("The desk phone's battery is at 30 percent.");
  });

  it('mentions low power mode', () => {
    expect(describeBattery(r(0.3, 'unplugged', true))).toMatch(/Low power mode is on\.$/);
  });
});

describe('batteryAlert', () => {
  it('says nothing about the first reading, so a reload never re-announces', () => {
    expect(batteryAlert(null, r(0.05, 'unplugged'))).toBeNull();
  });

  it('announces being unplugged', () => {
    expect(batteryAlert(r(0.6, 'charging'), r(0.6, 'unplugged'))).toEqual({ kind: 'unplugged', level: 0.6 });
    expect(batteryAlert(r(1, 'full'), r(1, 'unplugged'))).toEqual({ kind: 'unplugged', level: 1 });
  });

  it('is quiet about being plugged back in', () => {
    expect(batteryAlert(r(0.6, 'unplugged'), r(0.6, 'charging'))).toBeNull();
  });

  it('is quiet when unknown turns into unplugged', () => {
    // Not a transition we saw happen — the first real reading after an unknown one.
    expect(batteryAlert(r(null, 'unknown'), r(0.5, 'unplugged'))).toBeNull();
  });

  it('fires once at each threshold on the way down, off the cable', () => {
    expect(batteryAlert(r(0.21, 'unplugged'), r(0.2, 'unplugged'))).toBeNull();
    expect(batteryAlert(r(0.2, 'unplugged'), r(0.19, 'unplugged'))).toEqual({ kind: 'low', level: 0.19 });
    expect(batteryAlert(r(0.19, 'unplugged'), r(0.18, 'unplugged'))).toBeNull();
    expect(batteryAlert(r(0.1, 'unplugged'), r(0.09, 'unplugged'))).toEqual({ kind: 'low', level: 0.09 });
  });

  it('says one thing when a jump crosses both thresholds', () => {
    expect(batteryAlert(r(0.25, 'unplugged'), r(0.08, 'unplugged'))).toEqual({ kind: 'low', level: 0.08 });
  });

  it('is quiet about a low level while on the cable', () => {
    expect(batteryAlert(r(0.2, 'charging'), r(0.19, 'charging'))).toBeNull();
    expect(batteryAlert(r(0.2, 'not_charging'), r(0.19, 'not_charging'))).toBeNull();
  });

  it('is quiet when either level is unknown', () => {
    expect(batteryAlert(r(null, 'unplugged'), r(0.05, 'unplugged'))).toBeNull();
    expect(batteryAlert(r(0.3, 'unplugged'), r(null, 'unplugged'))).toBeNull();
  });
});

describe('alertLine', () => {
  it('speaks in the first person', () => {
    expect(alertLine({ kind: 'unplugged', level: 0.64 })).toBe("Heads up — I've been unplugged, and I'm at 64 percent.");
    expect(alertLine({ kind: 'unplugged', level: null })).toBe("Heads up — I've been unplugged.");
  });

  it('is more urgent below the last threshold', () => {
    expect(alertLine({ kind: 'low', level: 0.19 })).toBe("My battery's down to 19 percent, and I'm not plugged in.");
    expect(alertLine({ kind: 'low', level: 0.09 })).toMatch(/^I'm down to 9 percent battery\. I'll go dark soon/);
  });
});

describe("hermes' side", () => {
  it('says what was asked for', () => {
    expect(batteryReport(r(0.5, 'charging'))).toBe(
      "Battery reading you asked for: The desk phone's battery is at 50 percent and charging.",
    );
  });

  it('reports a failed read rather than inventing one', () => {
    expect(batteryReport(null)).toBe('Battery reading you asked for: The desk phone could not read its battery.');
  });

  it("gives the hermes brain the reading and tells it not to volunteer it", () => {
    const line = deskStatusLine(r(1, 'full'));
    expect(line).toContain('fully charged');
    expect(line).toMatch(/only if Michael asks/);
  });
});
