import { describe, expect, it } from '@jest/globals';
import {
  appendSegment,
  classifyFrame,
  createLipSync,
  EMPTY_TIMELINE,
  frameFeatures,
  LIPSYNC_FRAME_MS,
  smooth,
  visemeOnTimeline,
} from '../lipsync';
import { VIS } from '../visemes';

const FS = 24000;
const FRAME = (FS * LIPSYNC_FRAME_MS) / 1000;

function sine(hz: number, frames: number, amp = 0.3): Float32Array {
  const out = new Float32Array(frames * FRAME);
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / FS);
  return out;
}

/** Deterministic white noise — a hiss. */
function noise(frames: number, amp = 0.3): Float32Array {
  const out = new Float32Array(frames * FRAME);
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amp * ((seed / 0x7fffffff) * 2 - 1);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('frameFeatures', () => {
  it('reads a sinusoid back at its own frequency', () => {
    for (const hz of [200, 900, 3000]) {
      const f = frameFeatures(sine(hz, 1), 0, FRAME, FS);
      expect(f.centroid).toBeGreaterThan(hz * 0.95);
      expect(f.centroid).toBeLessThan(hz * 1.05);
      expect(f.rms).toBeCloseTo(0.3 / Math.SQRT2, 2);
    }
  });

  it('silence is all zeros, not NaN', () => {
    expect(frameFeatures(new Float32Array(FRAME), 0, FRAME, FS)).toEqual({ rms: 0, zcr: 0, centroid: 0, bright: 0 });
  });

  it('hiss crosses zero far more often than voice', () => {
    expect(frameFeatures(noise(1), 0, FRAME, FS).zcr).toBeGreaterThan(0.3);
    expect(frameFeatures(sine(200, 1), 0, FRAME, FS).zcr).toBeLessThan(0.03);
  });
});

describe('classifyFrame', () => {
  const peak = 0.25;
  const voiced = (rms: number, centroid: number, bright: number) => classifyFrame({ rms, zcr: 0.03, centroid, bright }, peak);

  it('rests below the silence floor, relative to the peak', () => {
    expect(classifyFrame({ rms: 0.01, zcr: 0.3, centroid: 5000, bright: 6000 }, peak)).toBe('sil');
  });

  it('hiss shows teeth: s high, f quiet', () => {
    expect(classifyFrame({ rms: 0.06, zcr: 0.6, centroid: 7500, bright: 8000 }, peak)).toBe('DT');
    expect(classifyFrame({ rms: 0.03, zcr: 0.4, centroid: 3100, bright: 5000 }, peak)).toBe('FV');
  });

  it('a faint low hum is pressed lips', () => {
    expect(voiced(0.035, 200, 1800)).toBe('MBP');
  });

  // Feature values below are frames measured from real 24 kHz speech.
  it('ee is spread', () => {
    expect(voiced(0.22, 602, 2839)).toBe('EE');
    expect(voiced(0.2, 526, 2917)).toBe('EE');
  });

  it('ah is open', () => {
    expect(voiced(0.21, 930, 1531)).toBe('AH');
    expect(voiced(0.14, 823, 1272)).toBe('AA');
  });

  it('oo is rounded and oh is round and open', () => {
    expect(voiced(0.21, 465, 2464)).toBe('OO');
    expect(voiced(0.17, 478, 994)).toBe('OH');
  });

  it('only ever names a shape the design has', () => {
    for (const rms of [0, 0.01, 0.05, 0.1, 0.2, 0.3])
      for (const zcr of [0, 0.1, 0.3, 0.7])
        for (const c of [0, 300, 700, 1000, 3000, 8000])
          for (const b of [0, 1000, 2200, 3000, 8000]) expect(VIS[classifyFrame({ rms, zcr, centroid: c, bright: b }, peak)]).toBeDefined();
  });
});

describe('createLipSync', () => {
  it('emits one viseme per frame, in order: shut, open, shut, hiss', () => {
    const ls = createLipSync(FS);
    const v = ls.analyze(concat(new Float32Array(2 * FRAME), sine(900, 3), new Float32Array(2 * FRAME), noise(2, 0.15)));
    expect(v).toHaveLength(9);
    expect(v.slice(0, 2)).toEqual(['sil', 'sil']);
    expect(v.slice(2, 5).every((k) => k === 'AH' || k === 'AA')).toBe(true);
    expect(v.slice(5, 7)).toEqual(['sil', 'sil']);
    expect(v.slice(7)).toEqual(['DT', 'DT']);
  });

  it('carries the peak across chunks, so a quiet chunk stays a quiet mouth', () => {
    const ls = createLipSync(FS);
    ls.analyze(sine(900, 2, 0.4));
    // A tenth of the earlier level: a murmur, not a fresh full-open vowel.
    const quiet = ls.analyze(sine(300, 2, 0.04));
    expect(quiet.every((k) => k === 'MBP' || k === 'L')).toBe(true);
  });

  it('a fresh analyser normalises to its own utterance', () => {
    const v = createLipSync(FS).analyze(sine(900, 2, 0.04));
    expect(v.every((k) => k === 'AH' || k === 'AA')).toBe(true);
  });
});

describe('smooth', () => {
  it('a one-frame gap between sounds is a closure, not a rest', () => {
    expect(smooth(['AA', 'sil', 'EE'], 'sil')).toEqual(['AA', 'MBP', 'EE']);
  });

  it('a real pause stays at rest', () => {
    expect(smooth(['AA', 'sil', 'sil', 'EE'], 'sil')).toEqual(['AA', 'sil', 'sil', 'EE']);
  });

  it('looks across the chunk seam', () => {
    expect(smooth(['sil', 'EE'], 'AA')).toEqual(['MBP', 'EE']);
    expect(smooth(['sil', 'EE'], 'sil')).toEqual(['sil', 'EE']);
  });
});

describe('mouth timeline', () => {
  const F = LIPSYNC_FRAME_MS;

  it('a chunk handed to an idle queue starts at once', () => {
    const tl = appendSegment(EMPTY_TIMELINE, ['AA', 'EE'], 2 * F, 1000);
    expect(visemeOnTimeline(tl, 1000)).toBe('AA');
    expect(visemeOnTimeline(tl, 1000 + F)).toBe('EE');
    expect(visemeOnTimeline(tl, 1000 + 2 * F)).toBe('sil');
  });

  it('a chunk queued behind another starts when that one ends, not when it was queued', () => {
    let tl = appendSegment(EMPTY_TIMELINE, ['AA', 'AA', 'AA'], 3 * F, 1000);
    tl = appendSegment(tl, ['OO'], F, 1010);
    expect(visemeOnTimeline(tl, 1000 + 2 * F + 5)).toBe('AA');
    expect(visemeOnTimeline(tl, 1000 + 3 * F)).toBe('OO');
  });

  it('after an underrun the next chunk starts when it arrives', () => {
    let tl = appendSegment(EMPTY_TIMELINE, ['AA'], F, 1000);
    tl = appendSegment(tl, ['EE'], F, 5000);
    expect(visemeOnTimeline(tl, 3000)).toBe('sil');
    expect(visemeOnTimeline(tl, 5000)).toBe('EE');
  });

  it('nothing plays before the first segment starts', () => {
    let tl = appendSegment(EMPTY_TIMELINE, ['AA'], F, 1000);
    tl = appendSegment(tl, ['EE'], F, 1000);
    expect(visemeOnTimeline(tl, 999)).toBe('sil');
  });

  it('drops segments that have played out', () => {
    let tl = appendSegment(EMPTY_TIMELINE, ['AA'], F, 1000);
    tl = appendSegment(tl, ['EE'], F, 9000);
    expect(tl.segments).toHaveLength(1);
  });
});
