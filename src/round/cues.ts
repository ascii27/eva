// Cues in a reply (ASC-59) — pure, no React, unit-tested.
//
// `[[face …]]` and `[[pause …]]` are the two tokens that are about *when*, not
// just *what*: a face belongs to the moment the words around it are said, and
// a pause is a moment of its own. So unlike the other desk tokens, which are
// read once off the finished message, these are cut out of the stream in order
// and handed to useEcho as items between the text, which plays them against
// the audio (see its cue player).
//
// Everything else — `[[sleep]]`, `[[look]]`, … — stays in the text, where
// speakableFromMrkdwn strips it as before.

import { readFaceTokens, type FaceToken } from '../face/expression';

export type CueItem =
  | { kind: 'text'; text: string }
  | { kind: 'face'; token: FaceToken }
  | { kind: 'pause'; ms: number };

/** A pause with no length given. Long enough to see a face, short enough not to read as a hang. */
export const PAUSE_DEFAULT_MS = 1000;
/** The longest pause honoured. Longer reads as a broken appliance, not as timing. */
export const PAUSE_MAX_MS = 4000;

const CUE_RE = /\[\[\s*(face|pause)\b[^\]]*\]\]/gi;
const PAUSE_ARG_RE = /^\[\[\s*pause\s*[:=]?\s*([^\]]*?)\s*\]\]$/i;
/**
 * How much of an unclosed `[[` is held back waiting for its `]]`. A real token
 * is short; past this it was never a token, and holding it any longer would
 * stall the speech behind it.
 */
const HOLD_MAX = 48;

/** Milliseconds for a pause token's argument: "", "1s", "1.5 seconds", "800", "800ms". */
export function pauseMs(arg: string): number {
  const a = arg.trim().toLowerCase();
  if (!a) return PAUSE_DEFAULT_MS;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)?$/.exec(a);
  if (!m) return PAUSE_DEFAULT_MS;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  // A bare number is seconds when small ("2") and milliseconds when large
  // ("800") — nobody means a two-millisecond pause or an 800-second one.
  const ms = unit.startsWith('m') ? n : unit ? n * 1000 : n <= 10 ? n * 1000 : n;
  return Math.round(Math.min(PAUSE_MAX_MS, Math.max(0, ms)));
}

/** Whether a message carries any face or pause cue at all. */
export function hasCues(raw: string): boolean {
  CUE_RE.lastIndex = 0;
  const hit = CUE_RE.test(raw);
  CUE_RE.lastIndex = 0;
  return hit;
}

export interface CueState {
  /** Text not yet released: an unclosed `[[` that may still become a cue. */
  held: string;
}

export const emptyCues = (): CueState => ({ held: '' });

function cut(text: string): CueItem[] {
  const out: CueItem[] = [];
  let at = 0;
  for (const m of text.matchAll(CUE_RE)) {
    const before = text.slice(at, m.index);
    if (before) out.push({ kind: 'text', text: before });
    at = (m.index ?? 0) + m[0].length;
    if (m[1].toLowerCase() === 'pause') {
      out.push({ kind: 'pause', ms: pauseMs(PAUSE_ARG_RE.exec(m[0])?.[1] ?? '') });
    } else {
      // An unknown face name is still cut out (it is never spoken), it just
      // changes nothing.
      const [token] = readFaceTokens(m[0]);
      if (token) out.push({ kind: 'face', token });
    }
  }
  const rest = text.slice(at);
  if (rest) out.push({ kind: 'text', text: rest });
  return out;
}

/**
 * Feed one streamed delta. Returns the items now safe to act on, in order;
 * anything that might be the start of a cue split across deltas is held.
 */
export function pushCues(state: CueState, delta: string): { state: CueState; items: CueItem[] } {
  const all = state.held + delta;
  // Hold back from the last `[[` that hasn't been closed — or a lone trailing
  // `[`, which may be the first half of one.
  let hold = -1;
  const open = all.lastIndexOf('[[');
  if (open >= 0 && all.indexOf(']]', open) < 0 && all.length - open <= HOLD_MAX) hold = open;
  else if (all.endsWith('[')) hold = all.length - 1;
  const ready = hold >= 0 ? all.slice(0, hold) : all;
  const held = hold >= 0 ? all.slice(hold) : '';
  return { state: { held }, items: cut(ready) };
}

/** The stream is over: release whatever was held. */
export function flushCues(state: CueState): CueItem[] {
  return state.held ? cut(state.held) : [];
}
