import { describe, expect, it } from '@jest/globals';
import { agePhrase, bandFor, describeLight, ev100FromExif, isDark, luxFromEv100, readingFromExif, roundLux } from '../light';

describe('ev100FromExif', () => {
  it("prefers iOS's BrightnessValue (APEX Bv): EV100 is Bv + 5", () => {
    expect(ev100FromExif({ BrightnessValue: 2, FNumber: 99, ExposureTime: 1, ISOSpeedRatings: [1] })).toBe(7);
    expect(ev100FromExif({ BrightnessValue: -4.5 })).toBe(0.5);
  });

  it('falls back to aperture, shutter and ISO', () => {
    // f/2.2, 1/60 s, ISO 400 — a lamp-lit evening room, about EV 6.
    const ev = ev100FromExif({ FNumber: 2.2, ExposureTime: 1 / 60, ISOSpeedRatings: [400] }) as number;
    expect(ev).toBeCloseTo(Math.log2((2.2 * 2.2) / (1 / 60)) - 2, 6);
    expect(ev).toBeGreaterThan(5.5);
    expect(ev).toBeLessThan(6.5);
  });

  it('accepts a bare number for ISO, and nothing usable as null', () => {
    expect(ev100FromExif({ FNumber: 1, ExposureTime: 1, ISOSpeedRatings: 100 })).toBe(0);
    expect(ev100FromExif({ FNumber: 2 })).toBeNull();
    expect(ev100FromExif({ FNumber: 0, ExposureTime: 1, ISOSpeedRatings: 100 })).toBeNull();
    expect(ev100FromExif({ BrightnessValue: NaN })).toBeNull();
    expect(ev100FromExif(null)).toBeNull();
    expect(ev100FromExif(undefined)).toBeNull();
  });
});

describe('bands', () => {
  it('maps lux onto the five bands at their floors', () => {
    expect(bandFor(0)).toBe('dark');
    expect(bandFor(9.9)).toBe('dark');
    expect(bandFor(10)).toBe('dim');
    expect(bandFor(80)).toBe('lit');
    expect(bandFor(500)).toBe('bright');
    expect(bandFor(5000)).toBe('daylight');
  });

  it('puts real rooms where you would expect them', () => {
    const band = (bv: number) => readingFromExif({ BrightnessValue: bv }, 0)?.band;
    expect(band(-5)).toBe('dark'); // lights off, a phone glowing
    expect(band(-1)).toBe('dim'); // one lamp across the room
    expect(band(2)).toBe('lit'); // an ordinary lit room
    expect(band(9)).toBe('daylight');
  });

  it('only dark counts as dark', () => {
    expect(isDark({ lux: 2, band: 'dark', at: 0 })).toBe(true);
    expect(isDark({ lux: 20, band: 'dim', at: 0 })).toBe(false);
  });

  it('is a monotone conversion', () => {
    expect(luxFromEv100(0)).toBe(2.5);
    expect(luxFromEv100(1)).toBe(5);
  });
});

describe('describing it', () => {
  it('rounds to two significant figures', () => {
    expect(roundLux(337.4)).toBe(340);
    expect(roundLux(5432)).toBe(5400);
    expect(roundLux(7.26)).toBe(7);
    expect(roundLux(0.34)).toBe(0.3);
  });

  it('says the band, a rough figure and how old it is', () => {
    expect(describeLight({ lux: 337.4, band: 'lit', at: 0 }, 10_000)).toBe(
      'The room at the desk is lit like a normal indoor room, about 340 lux, measured just now.',
    );
    expect(describeLight({ lux: 3, band: 'dark', at: 0 }, 5 * 60_000)).toBe(
      'The room at the desk is dark, about 3 lux, measured 5 minutes ago.',
    );
  });

  it('phrases ages for the ear', () => {
    expect(agePhrase(61_000)).toBe('a minute ago');
    expect(agePhrase(60 * 60_000)).toBe('an hour ago');
    expect(agePhrase(3 * 60 * 60_000)).toBe('3 hours ago');
  });
});
