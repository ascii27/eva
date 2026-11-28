// Expressions (ASC-59) — pure, no React, unit-tested.
//
// A mode says what the face is *doing* (listening, thinking, speaking); an
// expression says how she *feels about it*, and Eva picks it herself. It is a
// blend laid over the mode, like asleep is (geometry.ts's sleepK), not another
// mode: the wake watcher and the follow-up window key off modes, and a new
// mode per feeling would have to teach both of them about each one.
//
// The first nine poses are the static part of a pose the design already has —
// pleased, thinking, listening, alert, confused — so they invent almost no
// animation values (CLAUDE.md: change the design first, then port); only
// `concerned` is assembled from those poses' numbers. The second set (Michael
// asked for many more, Nov 28) needs two things the design never had: eyes
// that *rotate* (slanted in for angry and determined, out for sad) and a lid
// shape — flat top, round bottom, the crescent upside down — for bored, sleepy
// and side-eye. Those values are invented here and should be folded into
// Eva Face.dc.html in a design pass.
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
  | 'concerned'
  // The second set (ASC-59 follow-up): invented, not yet in the design.
  | 'excited'
  | 'adoring'
  | 'proud'
  | 'mischievous'
  | 'wink'
  | 'shy'
  | 'sad'
  | 'angry'
  | 'annoyed'
  | 'determined'
  | 'bored'
  | 'sleepy'
  | 'sideeye';

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
  'excited',
  'adoring',
  'proud',
  'mischievous',
  'wink',
  'shy',
  'sad',
  'angry',
  'annoyed',
  'determined',
  'bored',
  'sleepy',
  'sideeye',
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
  smirk: 'mischievous',
  confused: 'puzzled',
  unsure: 'puzzled',
  worried: 'concerned',
  sympathetic: 'concerned',
  sorry: 'sad',
  unhappy: 'sad',
  disappointed: 'sad',
  thrilled: 'excited',
  eager: 'excited',
  love: 'adoring',
  loving: 'adoring',
  fond: 'adoring',
  smug: 'proud',
  pleased_with_myself: 'proud',
  cheeky: 'mischievous',
  sly: 'mischievous',
  winking: 'wink',
  bashful: 'shy',
  embarrassed: 'shy',
  mad: 'angry',
  cross: 'angry',
  irritated: 'annoyed',
  grumpy: 'annoyed',
  focused: 'determined',
  resolute: 'determined',
  meh: 'bored',
  tired: 'sleepy',
  drowsy: 'sleepy',
  'side-eye': 'sideeye',
  suspicious: 'sideeye',
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
  excited: 0.9,
  adoring: 0.8,
  proud: 0.7,
  mischievous: 0.75,
  wink: 1,
  shy: 0.7,
  sad: 0.75,
  angry: 0.8,
  annoyed: 0.7,
  determined: 0.7,
  bored: 0.7,
  sleepy: 0.75,
  sideeye: 0.8,
};

export function parseExpression(word: string): Expression | null {
  const w = word.toLowerCase().trim();
  if ((EXPRESSIONS as string[]).includes(w)) return w as Expression;
  return ALIASES[w] ?? ALIASES[w.replace(/[\s-]+/g, '_')] ?? null;
}

// `[[face amused]]`; also `[[face: amused]]` and `[[face=amused]]`, since the
// other tokens tolerate both. An optional trailing word ("a little", "very")
// or number sets the strength.
export const FACE_TOKEN_RE = /\[\[\s*face\s*[:=]?\s*([a-z_-]+)(?:\s+([^\]]*?))?\s*\]\]/gi;

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

/** Which corner shape an eye wears. */
export type EyeShape = 'base' | 'crescent' | 'lid';

/** A pose as multipliers (sw, sh, g) and offsets (x, y, r) on the mode's own. */
export interface Pose {
  sw: number;
  sh: number;
  x: number;
  y: number;
  g: number;
  /** Rotation of this eye, degrees clockwise. Positive on the right eye and
   *  negative on the left slants the outer corners down (sad). */
  r: number;
  /** crescent: the design's pleased eye (round top, flat bottom).
   *  lid: the crescent upside down — flat top, round bottom, half-lidded. */
  shape: EyeShape;
}

function pose(sw: number, sh: number, x: number, y: number, g: number, r = 0, shape: EyeShape = 'base'): Pose {
  'worklet';
  return { sw, sh, x, y, g, r, shape };
}

export function expressionPose(name: string, side: number): Pose {
  'worklet';
  // --- From the design's own poses.
  // pleased
  if (name === 'happy' || name === 'amused') return pose(1, 0.52, 0, 8, 1.2, 0, 'crescent');
  // thinking, without its pulse: narrowed, glancing up and away
  if (name === 'thoughtful') return pose(0.96, 0.4, -22, -18, 0.92);
  // listening, without its sway
  if (name === 'curious') return pose(1.1, 1.22, 0, -6, 1.35);
  // alert, without its tremor
  if (name === 'surprised') return pose(1.24, 1.36, 0, 0, 2);
  // confused: one eye narrowed, the other raised. Skeptical is the eyes alone;
  // puzzled adds confused's head tilt and mouth (Face.tsx, visemes.ts).
  if (name === 'skeptical' || name === 'puzzled') {
    return side < 0 ? pose(0.9, 0.5, 0, 14, 0.9) : pose(1, 1.14, 0, -6, 0.9);
  }
  // thinking's narrowing, pleased's drop, confused's glow
  if (name === 'concerned') return pose(0.96, 0.4, 0, 8, 0.9);

  // --- Invented (ASC-59 follow-up); needs a design pass.
  // a bigger, brighter pleased
  if (name === 'excited') return pose(1.12, 0.62, 0, 2, 1.8, 0, 'crescent');
  // pleased, softly glowing and a touch lower
  if (name === 'adoring') return pose(1.04, 0.46, 0, 10, 1.7, 0, 'crescent');
  // pleased, chin up
  if (name === 'proud') return pose(1, 0.5, 0, -8, 1.3, 0, 'crescent');
  // pleased, slanted in like determined: up to something
  if (name === 'mischievous') return pose(1, 0.48, 0, 6, 1.3, -10 * side, 'crescent');
  // left eye shut in a crescent, right eye open
  if (name === 'wink') return side < 0 ? pose(1.04, 0.12, 0, 10, 1.1, 0, 'crescent') : pose(1, 1, 0, 0, 1.15);
  // pleased, glancing down and away
  if (name === 'shy') return pose(0.94, 0.5, 20, 16, 0.95, 0, 'crescent');
  // drooping, outer corners down, dim
  if (name === 'sad') return pose(0.96, 0.7, 0, 12, 0.8, 14 * side);
  // narrowed, inner corners down, hot
  if (name === 'angry') return pose(1.04, 0.58, 0, 4, 1.5, -16 * side);
  // half-lidded with a slight inward slant
  if (name === 'annoyed') return pose(1, 0.55, 0, 6, 1, -7 * side, 'lid');
  // narrowed and slanted in, steady and bright
  if (name === 'determined') return pose(1.06, 0.62, 0, 0, 1.4, -9 * side);
  // heavy-lidded, dim
  if (name === 'bored') return pose(1.02, 0.45, 0, 8, 0.75, 0, 'lid');
  // nearly shut under the lid, drooping
  if (name === 'sleepy') return pose(1, 0.3, 0, 12, 0.7, 6 * side, 'lid');
  // half-lidded, looking hard to one side
  if (name === 'sideeye') return pose(0.96, 0.48, 30, 2, 1, 0, 'lid');
  return pose(1, 1, 0, 0, 1);
}

/** Whether the expression tilts the head, as confused does. */
export function tilts(name: Expression): boolean {
  return name === 'puzzled';
}
