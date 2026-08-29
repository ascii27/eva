import { VISEME_FRAME_MS } from './constants';
import { corners, uniformCorners } from './geometry';
import type { CornerRadii, FaceMode } from './types';

export interface Viseme {
  w: number;
  h: number;
  corners: CornerRadii;
  teeth?: boolean;
  tongue?: boolean;
  label: string;
}

// 13-shape English phoneme set, ported from the design's VIS table.
// CSS border-radius specs are translated to per-corner px (tl tr br bl).
export const VIS: Record<string, Viseme> = {
  sil: { w: 66, h: 6, corners: uniformCorners(3), label: 'rest' },
  MBP: { w: 88, h: 10, corners: uniformCorners(5), label: 'm b p' },
  AA: {
    w: 92,
    h: 72,
    // 46% 46% 50% 50% / 42% 42% 58% 58%
    corners: corners(92, 72, [92 * 0.46, 92 * 0.46, 92 * 0.5, 92 * 0.5], [72 * 0.42, 72 * 0.42, 72 * 0.58, 72 * 0.58]),
    label: 'ah',
  },
  AH: {
    w: 112,
    h: 86,
    // 48%
    corners: corners(112, 86, [112 * 0.48, 112 * 0.48, 112 * 0.48, 112 * 0.48], [86 * 0.48, 86 * 0.48, 86 * 0.48, 86 * 0.48]),
    label: 'surprised',
  },
  EE: { w: 118, h: 30, corners: corners(118, 30, [16, 16, 20, 20], [16, 16, 20, 20]), teeth: true, label: 'ee' },
  IH: { w: 96, h: 44, corners: corners(96, 44, [20, 20, 24, 24], [20, 20, 24, 24]), label: 'i' },
  OH: { w: 70, h: 64, corners: corners(70, 64, [35, 35, 35, 35], [32, 32, 32, 32]), label: 'oh' },
  OO: { w: 42, h: 40, corners: corners(42, 40, [21, 21, 21, 21], [20, 20, 20, 20]), label: 'ooo w' },
  DT: { w: 100, h: 18, corners: uniformCorners(6), teeth: true, label: 'd t s z' },
  FV: { w: 102, h: 22, corners: corners(102, 22, [3, 3, 14, 14], [3, 3, 14, 14]), teeth: true, label: 'f v' },
  L: { w: 86, h: 48, corners: corners(86, 48, [22, 22, 26, 26], [22, 22, 26, 26]), tongue: true, label: 'l n' },
  K: {
    w: 80,
    h: 38,
    // 40% 40% 46% 46%
    corners: corners(80, 38, [80 * 0.4, 80 * 0.4, 80 * 0.46, 80 * 0.46], [38 * 0.4, 38 * 0.4, 38 * 0.46, 38 * 0.46]),
    label: 'k g r',
  },
  TH: { w: 90, h: 34, corners: corners(90, 34, [18, 18, 18, 18], [18, 18, 18, 18]), tongue: true, teeth: true, label: 'th' },
};

export type VisemeKey = keyof typeof VIS;
export const VISEME_KEYS = Object.keys(VIS) as VisemeKey[];

// Pleased overrides the mouth with a smile arc: 104x30,
// border-radius 6px 6px 60% 60% / 6px 6px 100% 100%
export const SMILE: Viseme = {
  w: 104,
  h: 30,
  corners: corners(104, 30, [6, 6, 104 * 0.6, 104 * 0.6], [6, 6, 30, 30]),
  label: 'smile',
};

// One plausible utterance, hard-swapped at ~112ms per frame.
export const SEQ: VisemeKey[] = [
  'MBP', 'AA', 'DT', 'EE', 'sil', 'L', 'OH', 'DT', 'AA', 'K', 'sil', 'FV', 'IH',
  'DT', 'MBP', 'OO', 'AH', 'L', 'EE', 'TH', 'sil', 'OH', 'K', 'AA', 'DT', 'sil',
];

/**
 * `voicing` is whether sound is actually coming out. It is separate from the
 * mode because the mode cannot tell: she stays in 'speaking' across the gaps
 * inside a reply — synthesis falling behind, a tool running — and a mouth that
 * keeps miming through those reads as a glitch rather than as thinking.
 */
export function pickViseme(
  mode: FaceMode,
  t: number,
  frozen: VisemeKey | null,
  voicing = true,
): VisemeKey {
  if (frozen) return frozen;
  if (mode === 'speaking') return voicing ? SEQ[Math.floor(t / VISEME_FRAME_MS) % SEQ.length] : 'sil';
  if (mode === 'alert') return 'OH';
  if (mode === 'confused') return 'K';
  return 'sil';
}

/** Whether the smile arc replaces the viseme shape. */
export function isSmiling(mode: FaceMode, frozen: VisemeKey | null): boolean {
  return mode === 'pleased' && !frozen;
}

/** Black cut-out strip along the top edge (teeth). */
export function teethHeight(v: Viseme): number {
  return Math.max(2, v.h * 0.42);
}

export const TONGUE = { w: 34, h: 22, overhang: 6 };

/** Waveform bar amplitude, 0..~1, ported from the design's amp(). */
export function amp(i: number, n: number, t: number, mode: FaceMode, voicing = true): number {
  'worklet';
  const u = i / (n - 1);
  const mid = 1 - Math.abs(u - 0.5) * 2;
  if (mode === 'speaking') {
    // Silent stretch inside a reply: hold the bars at the speaking floor so
    // they stop moving without collapsing to a different resting shape.
    if (!voicing) return 0.05;
    return Math.max(
      0.05,
      mid * (0.35 + 0.65 * Math.abs(Math.sin(t / 190 + i * 0.55) * Math.sin(t / 640 + i * 0.2))),
    );
  }
  if (mode === 'listening') return 0.08 + 0.22 * mid * (0.5 + 0.5 * Math.sin(t / 620 + i * 0.4));
  if (mode === 'thinking') {
    const c = ((t / 22) % (n * 1.6)) / 1.6;
    return 0.05 + 0.45 * Math.max(0, 1 - Math.abs(i - c) / 3);
  }
  if (mode === 'alert') return 0.55 * mid + 0.1;
  if (mode === 'confused') return 0.06 + 0.18 * Math.abs(Math.sin(i * 2.3 + t / 300));
  if (mode === 'pleased') return 0.1 + 0.3 * mid;
  return 0.04;
}
