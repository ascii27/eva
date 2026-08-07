import { describe, expect, it } from '@jest/globals';
import { hhmm } from '../time';

describe('hhmm', () => {
  it('zero-pads hours and minutes', () => {
    expect(hhmm(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
    expect(hhmm(new Date(2026, 0, 1, 23, 59))).toBe('23:59');
  });

  it('accepts epoch milliseconds', () => {
    expect(hhmm(new Date(2026, 0, 1, 7, 30).getTime())).toBe('07:30');
  });
});
