// Expressions (ASC-59) — pure, no React, unit-tested.
//
// A mode says what the face is *doing* (listening, thinking, speaking); an
// expression says how she *feels about it*, and Eva picks it herself. It is a
// blend laid over the mode, like asleep is (geometry.ts's sleepK), not another
// mode: the wake watcher and the follow-up window key off modes, and a new
// mode per feeling would have to teach both of them about each one.
//
// Every pose below is the static part of a pose the design already has —
// pleased, thinking, listening, alert, confused — so this invents almost no
// animation values (CLAUDE.md: change the design first, then port). The one
// exception is `concerned`, which the design has nothing like; it is assembled
// from those same poses' numbers (thinking's narrowing, pleased's drop,
// confused's glow) and should get a proper pass in Eva Face.dc.html.
//
// Eva asks for one with a token in her reply, `[[face amused]]`, exactly as
// hermes asks for `[[sleep]]`: stripped before speaking (directives.ts's
// DIRECTIVE_RE), and acted on as it streams past.

import type { Traits } from '../personality/traits';
import type { FaceMode } from './types';

export type Expression =
  | 'neutral'
  | 'happy'
  | 'amused'
  | 'thoughtful'
  | 'curious'
  | 'surprised'
  | 'skeptical'
  | 'puzzled'
  | 'concerned';

export const EXPRESSIONS: Expression[] = [
  'neutral',
  'happy',
  'amused',
  'thoughtful',
  'curious',
  'surprised',
  'skeptical',
  'puzzled',
  'concerned',
];

export interface ExpressionState {
  name: Expression;
  /** 0 … 1: how far the face is pulled toward the pose. */
  intensity: number;
}

export const NEUTRAL: ExpressionState = { name: 'neutral', intensity: 0 };

/**
 * Words the model might reach for instead of the canonical name. A near-miss
 * still lands on a face rather than being ignored — the token is stripped from
 * speech either way, so silently dropping it would just lose the intent.
 */
const ALIASES: Record<string, Expression> = {
  smile: 'happy',
  smiling: 'happy',
  pleased: 'happy',
  glad: 'happy',
  delighted: 'happy',
  joy: 'happy',
  laugh: 'amused',
  laughing: 'amused',
  wry: 'amused',
  playful: 'amused',
  think: 'thoughtful',
  thinking: 'thoughtful',
  pensive: 'thoughtful',
  interested: 'curious',
  intrigued: 'curious',
  attentive: 'curious',
  shocked: 'surprised',
  wow: 'surprised',
  surprise: 'surprised',
  sassy: 'skeptical',
  unimpressed: 'skeptical',
  doubtful: 'skeptical',
  smirk: 'skeptical',
  confused: 'puzzled',
  unsure: 'puzzled',
  worried: 'concerned',
  sad: 'concerned',
  sympathetic: 'concerned',
  sorry: 'concerned',
  calm: 'neutral',
  rest: 'neutral',
  none: 'neutral',
};

/** How strongly each one is worn when Eva doesn't say, before personality scales it. */
export const BASE_INTENSITY: Record<Expression, number> = {
  neutral: 0,
  happy: 0.9,
  amused: 0.6,
  thoughtful: 0.6,
  curious: 0.6,
  surprised: 0.8,
  skeptical: 0.7,
  puzzled: 0.7,
  concerned: 0.7,
};

export function parseExpression(word: string): Expression | null {
  const w = word.toLowerCase().trim();
  if ((EXPRESSIONS as string[]).includes(w)) return w as Expression;
  return ALIASES[w] ?? null;
}

// `[[face amused]]`; also `[[face: amused]]` and `[[face=amused]]`, since the
// other tokens tolerate both. An optional trailing word ("a little", "very")
// or number sets the strength.
export const FACE_TOKEN_RE = /\[\[\s*face\s*[:=]?\s*([a-z-]+)(?:\s+([^\]]*?))?\s*\]\]/gi;

/** A strength word or number from a token, as a multiplier on the base intensity. */
function strength(arg: string | undefined): number {
  if (!arg) return 1;
  const a = arg.toLowerCase().trim();
  const n = Number(a.replace(/%$/, ''));
  // A number is a share of full strength: 0.5, or 50 / 50%.
  if (a && Number.isFinite(n)) return Math.max(0, n > 1 ? Math.min(1, n / 100) : n);
  if (/\b(slight(ly)?|little|bit|faint(ly)?|soft(ly)?|subtle)\b/.test(a)) return 0.6;
  if (/\b(very|really|big|wide|totally|so)\b/.test(a)) return 1.35;
  return 1;
}

export interface FaceToken {
  name: Expression;
  /** Multiplier on BASE_INTENSITY the token asked for; 1 when it didn't say. */
  strength: number;
}

/** Every face token in a message, in order. Unknown names are skipped. */
export function readFaceTokens(raw: string): FaceToken[] {
  const out: FaceToken[] = [];
  for (const m of raw.matchAll(FACE_TOKEN_RE)) {
    const name = parseExpression(m[1]);
    if (name) out.push({ name, strength: strength(m[2]) });
  }
  return out;
}

/**
 * The face tokens that arrived since the last look, for a reply that streams.
 * `seen` is how many tokens the text had last time; a token split across two
 * deltas simply isn't counted until its closing brackets arrive.
 */
export function newFaceTokens(text: string, seen: number): { tokens: FaceToken[]; seen: number } {
  const all = readFaceTokens(text);
  return { tokens: all.slice(seen), seen: all.length };
}

/**
 * How much bigger or smaller this personality wears every expression. An
 * energetic, warm Eva emotes broadly; a calm, cool one barely moves. 0.55 at
 * the bottom of both sliders, 1.25 at the top.
 */
export function expressiveness(t: Traits): number {
  return 0.55 + 0.45 * t.energy + 0.25 * t.warmth;
}

/** A token, worn by this personality. */
export function wear(token: FaceToken, t: Traits): ExpressionState {
  if (token.name === 'neutral') return NEUTRAL;
  const i = BASE_INTENSITY[token.name] * token.strength * expressiveness(t);
  return { name: token.name, intensity: Math.round(Math.min(1, Math.max(0.15, i)) * 100) / 100 };
}

/**
 * The face she settles back to when nothing in particular is going on — and,
 * since the smile was removed (ASC-59), the face she ends a reply on when she
 * didn't pick one. Most personalities rest neutral; a sunny one rests on a
 * soft smile, a sassy one on a faintly raised brow. Ordered so the strongest
 * lean wins.
 */
export function restingExpression(t: Traits): ExpressionState {
  const cheer = (t.warmth + t.humor) / 2;
  if (cheer >= 0.78) return { name: 'happy', intensity: 0.55 };
  if (t.sass >= 0.75) return { name: 'skeptical', intensity: 0.35 };
  if (t.humor >= 0.75) return { name: 'amused', intensity: 0.35 };
  if (t.curiosity >= 0.75) return { name: 'curious', intensity: 0.3 };
  return NEUTRAL;
}

/**
 * How long a picked expression is held once the face is quiet before it
 * eases back to the resting one. Long enough to read as her reaction to what
 * was just said, short enough that a "concerned" doesn't outlive the topic.
 */
export const EXPRESSION_HOLD_MS = 20_000;

/** Cross-fade when one expression replaces another: out, swap, in. */
export const EXPRESSION_OUT_MS = 180;
export const EXPRESSION_IN_MS = 320;

// ---------------------------------------------------------------------------
// Rendering. Worklets: these run on the UI thread inside eyeGeo.

/** Which modes wear an expression. Listening, thinking and alert are the face
 *  telling you what she is doing, and keep their own pose untouched. */
export function expressionWeight(mode: FaceMode): number {
  'worklet';
  return mode === 'idle' || mode === 'resting' || mode === 'speaking' ? 1 : 0;
}

/** A pose as multipliers (sw, sh, g) and offsets (x, y) on the mode's own. */
export interface Pose {
  sw: number;
  sh: number;
  x: number;
  y: number;
  g: number;
  /** Wear the design's pleased eye corners (the smiling crescent). */
  crescent: boolean;
}

export function expressionPose(name: string, side: number): Pose {
  'worklet';
  // pleased
  if (name === 'happy' || name === 'amused') return { sw: 1, sh: 0.52, x: 0, y: 8, g: 1.2, crescent: true };
  // thinking, without its pulse: narrowed, glancing up and away
  if (name === 'thoughtful') return { sw: 0.96, sh: 0.4, x: -22, y: -18, g: 0.92, crescent: false };
  // listening, without its sway
  if (name === 'curious') return { sw: 1.1, sh: 1.22, x: 0, y: -6, g: 1.35, crescent: false };
  // alert, without its tremor
  if (name === 'surprised') return { sw: 1.24, sh: 1.36, x: 0, y: 0, g: 2, crescent: false };
  // confused: one eye narrowed, the other raised. Skeptical is the eyes alone;
  // puzzled adds confused's head tilt and mouth (Face.tsx, visemes.ts).
  if (name === 'skeptical' || name === 'puzzled') {
    return side < 0
      ? { sw: 0.9, sh: 0.5, x: 0, y: 14, g: 0.9, crescent: false }
      : { sw: 1, sh: 1.14, x: 0, y: -6, g: 0.9, crescent: false };
  }
  // Not in the design: thinking's narrowing, pleased's drop, confused's glow.
  if (name === 'concerned') return { sw: 0.96, sh: 0.4, x: 0, y: 8, g: 0.9, crescent: false };
  return { sw: 1, sh: 1, x: 0, y: 0, g: 1, crescent: false };
}

/** Whether the expression tilts the head, as confused does. */
export function tilts(name: Expression): boolean {
  return name === 'puzzled';
}
