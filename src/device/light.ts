// How bright the room is (ASC-46) — pure, no React, no native module.
//
// iOS gives apps no ambient light sensor: the one behind the earpiece drives
// auto-brightness and nothing else, and expo-sensors' LightSensor is
// Android-only. So the front camera is the light meter. useLightMeter takes a
// throwaway frame, and this file turns its EXIF exposure into a reading. The
// pixels are never looked at and the file is deleted at once, which is why
// this needs no spoken consent where camera_look does (Michael's decision,
// Nov 27): it measures the room, it doesn't see it.
//
// The numbers are an estimate, not a lux meter. Auto-exposure meters reflected
// light off whatever the lens faces, and the conversion to illuminance assumes
// a mid-grey scene. Good to a stop or so, which is plenty to tell a dark room
// from a lamp-lit one from daylight — and that is all anything here asks.

/** Coarse bands, which is what anyone actually wants to know. */
export type LightBand = 'dark' | 'dim' | 'lit' | 'bright' | 'daylight';

export interface LightReading {
  /** Estimated illuminance at the desk, in lux. */
  lux: number;
  band: LightBand;
  /** When it was measured, ms. */
  at: number;
}

/** Lower lux bound of each band above 'dark', in ascending order. */
export const BAND_FLOORS: [LightBand, number][] = [
  ['dim', 10],
  ['lit', 80],
  ['bright', 500],
  ['daylight', 5000],
];

/** Incident-light meter calibration constant (ISO 2720's C ≈ 250, over 100). */
const LUX_PER_EV0 = 2.5;

const num = (v: unknown): number | null => {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Exposure value at ISO 100 from a frame's EXIF, or null when it carries too
 * little to say. iOS writes `BrightnessValue` (APEX Bv) directly, and EV100 is
 * Bv + 5. Failing that it is derived from aperture, shutter and ISO.
 */
export function ev100FromExif(exif: Record<string, unknown> | null | undefined): number | null {
  if (!exif) return null;
  const bv = num(exif.BrightnessValue);
  if (bv !== null) return bv + 5;
  const n = num(exif.FNumber);
  const t = num(exif.ExposureTime);
  const iso = num(exif.ISOSpeedRatings) ?? num(exif.PhotographicSensitivity);
  if (n === null || t === null || iso === null || n <= 0 || t <= 0 || iso <= 0) return null;
  return Math.log2((n * n) / t) - Math.log2(iso / 100);
}

export function luxFromEv100(ev: number): number {
  return LUX_PER_EV0 * 2 ** ev;
}

export function bandFor(lux: number): LightBand {
  let band: LightBand = 'dark';
  for (const [b, floor] of BAND_FLOORS) if (lux >= floor) band = b;
  return band;
}

/** A reading from a frame's EXIF, or null when the exposure can't be read. */
export function readingFromExif(exif: Record<string, unknown> | null | undefined, at: number): LightReading | null {
  const ev = ev100FromExif(exif);
  if (ev === null) return null;
  const lux = luxFromEv100(ev);
  return { lux, band: bandFor(lux), at };
}

/** Two significant figures: "about 340 lux" is honest, "337.4" is not. */
export function roundLux(lux: number): number {
  if (lux < 1) return Math.round(lux * 10) / 10;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(lux)) - 1);
  return Math.round(lux / mag) * mag;
}

const BAND_PHRASE: Record<LightBand, string> = {
  dark: 'dark',
  dim: 'dimly lit',
  lit: 'lit like a normal indoor room',
  bright: 'brightly lit',
  daylight: 'in full daylight',
};

/** How old a reading is, for the ear. */
export function agePhrase(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min === 1) return 'a minute ago';
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  return h === 1 ? 'an hour ago' : `${h} hours ago`;
}

/** One sentence about the room, third person so either half can say it. */
export function describeLight(r: LightReading, now: number): string {
  const when = agePhrase(now - r.at);
  return `The room at the desk is ${BAND_PHRASE[r.band]}, about ${roundLux(r.lux)} lux, measured ${when}.`;
}
