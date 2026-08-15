import { describe, expect, it } from '@jest/globals';
import { formatClock } from '../clock';

/** Local time, which is the only time the appliance cares about. */
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min);

describe('formatClock', () => {
  it('names the weekday, month, day and year', () => {
    expect(formatClock(at(2026, 8, 15, 15, 42))).toContain('Saturday, August 15, 2026');
  });

  it('uses a twelve-hour clock', () => {
    expect(formatClock(at(2026, 8, 15, 15, 42))).toContain('3:42');
  });

  it('pads the minutes but never the hour', () => {
    expect(formatClock(at(2026, 8, 15, 9, 5))).toContain('9:05');
  });

  it('says midnight rather than a zero hour', () => {
    expect(formatClock(at(2026, 8, 15, 0, 0))).toContain('midnight');
  });

  it('says noon rather than twelve in the afternoon', () => {
    expect(formatClock(at(2026, 8, 15, 12, 0))).toContain('noon');
  });

  it('renders the midnight hour as twelve, not zero', () => {
    expect(formatClock(at(2026, 8, 15, 0, 30))).toContain('12:30');
  });

  it('places the hour in the part of the day a person would name', () => {
    expect(formatClock(at(2026, 8, 15, 9, 0))).toContain('in the morning');
    expect(formatClock(at(2026, 8, 15, 14, 0))).toContain('in the afternoon');
    expect(formatClock(at(2026, 8, 15, 18, 0))).toContain('in the evening');
    expect(formatClock(at(2026, 8, 15, 23, 0))).toContain('at night');
  });

  it('produces nothing unlistenable — no ISO stamp, no 24-hour time', () => {
    // The model reads this back aloud, so anything it might parrot has to be
    // sayable. A 24-hour "15:42" or an ISO "2026-08-15T15:42:00Z" is not.
    for (const hour of [0, 5, 9, 12, 15, 18, 23]) {
      const out = formatClock(at(2026, 8, 15, hour, 42));
      expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(out).not.toMatch(/T\d{2}:\d{2}/);
      expect(out).not.toMatch(/\b(1[3-9]|2[0-3]):\d{2}/);
    }
  });
});
