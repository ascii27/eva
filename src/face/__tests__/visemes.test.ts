import { describe, expect, it } from '@jest/globals';
import { VISEME_FRAME_MS } from '../constants';
import {
  amp,
  isSmiling,
  pickViseme,
  SEQ,
  SMILE,
  teethHeight,
  TONGUE,
  VIS,
  VISEME_KEYS,
} from '../visemes';
import type { FaceMode } from '../types';

const MODES: FaceMode[] = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'confused', 'pleased'];

describe('VIS table', () => {
  it('has the 13 shapes from the design', () => {
    expect(VISEME_KEYS).toHaveLength(13);
    expect(VISEME_KEYS).toEqual(
      expect.arrayContaining(['sil', 'MBP', 'AA', 'AH', 'EE', 'IH', 'OH', 'OO', 'DT', 'FV', 'L', 'K', 'TH']),
    );
  });

  it('every SEQ frame refers to a real viseme', () => {
    for (const k of SEQ) expect(VIS[k]).toBeDefined();
  });

  it('corner radii never overlap their box (CSS clamp applied)', () => {
    for (const v of [...Object.values(VIS), SMILE]) {
      expect(v.corners.tl.x + v.corners.tr.x).toBeLessThanOrEqual(v.w + 1e-6);
      expect(v.corners.bl.x + v.corners.br.x).toBeLessThanOrEqual(v.w + 1e-6);
      expect(v.corners.tl.y + v.corners.bl.y).toBeLessThanOrEqual(v.h + 1e-6);
      expect(v.corners.tr.y + v.corners.br.y).toBeLessThanOrEqual(v.h + 1e-6);
    }
  });

  it('teeth strip fills 42% of tall shapes, min 2px', () => {
    expect(teethHeight(VIS.EE)).toBeCloseTo(30 * 0.42);
    expect(teethHeight(VIS.sil)).toBe(2.52);
    expect(TONGUE).toEqual({ w: 34, h: 22, overhang: 6 });
  });
});

describe('pickViseme', () => {
  it('freezing wins over everything', () => {
    expect(pickViseme('speaking', 999, 'OO')).toBe('OO');
    expect(pickViseme('idle', 0, 'TH')).toBe('TH');
  });

  it('speaking walks SEQ at the frame rate, wrapping', () => {
    expect(pickViseme('speaking', 0, null)).toBe(SEQ[0]);
    expect(pickViseme('speaking', VISEME_FRAME_MS * 3 + 1, null)).toBe(SEQ[3]);
    expect(pickViseme('speaking', VISEME_FRAME_MS * (SEQ.length + 2) + 1, null)).toBe(SEQ[2]);
  });

  it('alert holds OH, confused holds K, everything else rests', () => {
    expect(pickViseme('alert', 5000, null)).toBe('OH');
    expect(pickViseme('confused', 5000, null)).toBe('K');
    expect(pickViseme('idle', 5000, null)).toBe('sil');
    expect(pickViseme('listening', 5000, null)).toBe('sil');
    expect(pickViseme('thinking', 5000, null)).toBe('sil');
  });

  it('pleased smiles unless a viseme is frozen', () => {
    expect(isSmiling('pleased', null)).toBe(true);
    expect(isSmiling('pleased', 'AA')).toBe(false);
    expect(isSmiling('speaking', null)).toBe(false);
  });
});

describe('amp', () => {
  it('stays within renderable bounds for all modes over time', () => {
    const n = 34;
    for (const mode of MODES) {
      for (let t = 0; t < 10000; t += 61) {
        for (let i = 0; i < n; i++) {
          const a = amp(i, n, t, mode);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(1.05);
        }
      }
    }
  });

  it('idle is a flat whisper, speaking peaks mid-row', () => {
    expect(amp(5, 34, 1234, 'idle')).toBe(0.04);
    const edge = amp(0, 34, 500, 'alert');
    const mid = amp(17, 34, 500, 'alert');
    expect(mid).toBeGreaterThan(edge);
  });
});
