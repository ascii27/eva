import {
  BLINK_MS,
  EYE_H,
  EYE_RADIUS,
  EYE_W,
  SLEEPY_END_HOUR,
  SLEEPY_START_HOUR,
  YAWN_MS,
} from './constants';
import type { CornerRadii, EyeGeo, FaceMode } from './types';

/**
 * CSS border-radius overlap rule: if adjacent radii on any edge sum past the
 * edge length, every radius is scaled by the smallest edge ratio.
 */
export function clampCorners(w: number, h: number, c: CornerRadii): CornerRadii {
  'worklet';
  const f = Math.min(
    1,
    w / (c.tl.x + c.tr.x) || 1,
    w / (c.bl.x + c.br.x) || 1,
    h / (c.tl.y + c.bl.y) || 1,
    h / (c.tr.y + c.br.y) || 1,
  );
  if (f >= 1) return c;
  return {
    tl: { x: c.tl.x * f, y: c.tl.y * f },
    tr: { x: c.tr.x * f, y: c.tr.y * f },
    br: { x: c.br.x * f, y: c.br.y * f },
    bl: { x: c.bl.x * f, y: c.bl.y * f },
  };
}

/** Corner radii from CSS-style horizontal/vertical lists (px), tl tr br bl. */
export function corners(
  w: number,
  h: number,
  hs: [number, number, number, number],
  vs: [number, number, number, number],
): CornerRadii {
  'worklet';
  return clampCorners(w, h, {
    tl: { x: hs[0], y: vs[0] },
    tr: { x: hs[1], y: vs[1] },
    br: { x: hs[2], y: vs[2] },
    bl: { x: hs[3], y: vs[3] },
  });
}

export function uniformCorners(r: number): CornerRadii {
  'worklet';
  return {
    tl: { x: r, y: r },
    tr: { x: r, y: r },
    br: { x: r, y: r },
    bl: { x: r, y: r },
  };
}

// Design: border-radius:50% 50% 12px 12px / 90% 90% 16px 16px on a 104x132 eye
export const EYE_CORNERS_BASE = uniformCorners(EYE_RADIUS);
export const EYE_CORNERS_PLEASED = corners(
  EYE_W,
  EYE_H,
  [EYE_W * 0.5, EYE_W * 0.5, 12, 12],
  [EYE_H * 0.9, EYE_H * 0.9, 16, 16],
);

/** Vertical scale factor for the 170ms triangular blink. 1 = eye open. */
export function blinkFactor(t: number, blinkT: number): number {
  'worklet';
  const bt = t - blinkT;
  if (bt < 0 || bt >= BLINK_MS) return 1;
  const k = 1 - Math.abs(bt / (BLINK_MS / 2) - 1);
  return 1 - 0.95 * k;
}

/**
 * Yawn envelope: droop 600ms, hold 900ms nearly shut, overshoot open, settle.
 * Returns multipliers for scaleY / scaleX / glow, or null outside the yawn.
 */
export function yawnFactor(
  t: number,
  yawnT: number,
): { sh: number; sw: number; g: number } | null {
  'worklet';
  const yt = t - yawnT;
  if (yt < 0 || yt >= YAWN_MS) return null;
  let k: number;
  if (yt < 600) k = 1 - 0.85 * (yt / 600);
  else if (yt < 1500) k = 0.15;
  else if (yt < 1900) k = 0.15 + 1.15 * ((yt - 1500) / 400);
  else k = 1.3 - 0.3 * ((yt - 1900) / 500);
  return { sh: k, sw: 0.94 + 0.1 * k, g: 0.8 + 0.4 * k };
}

/**
 * The heart of the face: one eye's deformation at time t (ms) for a mode.
 * side is -1 (left) or 1 (right). Direct port of geo() in Eva Face.dc.html.
 */
export function eyeGeo(
  side: number,
  t: number,
  mode: FaceMode,
  blinkT: number,
  yawnT: number,
): EyeGeo {
  'worklet';
  let sw = 1;
  let sh = 1;
  let x = 0;
  let y = 0;
  let g = 1;
  let corners_ = EYE_CORNERS_BASE;

  if (mode === 'idle') {
    x = Math.sin(t / 3700) * 10;
    y = Math.sin(t / 2600) * 5;
    g = 0.9 + 0.08 * Math.sin(t / 2000);
  } else if (mode === 'listening') {
    sw = 1.1;
    sh = 1.22;
    y = -6;
    x = Math.sin(t / 900) * 8;
    g = 1.35;
  } else if (mode === 'thinking') {
    sh = 0.4;
    sw = 0.96;
    x = -22 + Math.sin(t / 1500) * 4;
    y = -18;
    g = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(t / 700));
  } else if (mode === 'speaking') {
    const p = Math.abs(Math.sin(t / 210)) * Math.abs(Math.sin(t / 830));
    sh = 1 + 0.12 * p;
    sw = 1 - 0.04 * p;
    g = 1 + 0.5 * p;
  } else if (mode === 'alert') {
    sw = 1.24;
    sh = 1.36;
    g = 2;
    x = Math.sin(t / 55) * 1.4;
  } else if (mode === 'confused') {
    if (side < 0) {
      sh = 0.5;
      sw = 0.9;
      y = 14;
    } else {
      sh = 1.14;
      y = -6;
    }
    x = Math.sin(t / 1900) * 5;
    g = 0.9;
  } else if (mode === 'pleased') {
    sh = 0.52;
    y = 8;
    corners_ = EYE_CORNERS_PLEASED;
    g = 1.2;
  }

  sh *= blinkFactor(t, blinkT);

  const yn = yawnFactor(t, yawnT);
  if (yn) {
    sh *= yn.sh;
    sw *= yn.sw;
    g *= yn.g;
  }

  return { sw, sh, x, y, g, corners: corners_ };
}

export function isSleepyHour(hour: number): boolean {
  return hour < SLEEPY_END_HOUR || hour >= SLEEPY_START_HOUR;
}

export function hexToRgba(hex: string, alpha: number): string {
  'worklet';
  let c = hex.replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const n = parseInt(c, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
