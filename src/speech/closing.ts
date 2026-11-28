// End of conversation (ASC-66) — pure, no React, unit-tested.
//
// After a reply the follow-up mic re-opens (conversation.ts), and until now the
// only thing that closed it was ten seconds of silence. So a "thanks!" got
// answered and then the room was listened to for another ten seconds, and
// people talking to each other inside that window became questions. This module
// is the device's half of knowing a conversation is over:
//
// - **Closers** — a whole utterance that is only a sign-off. Two kinds, and the
//   difference is whether she says anything: a *dismissal* ("never mind",
//   "that's all") goes to no brain at all and the face simply settles; a
//   *farewell* ("thanks", "goodnight") is answered as usual — that is where a
//   goodnight can still put her to sleep — but no follow-up mic opens after.
//   Only whole utterances count, so "thanks, and what's on tomorrow?" stays a
//   question.
// - The brains' half is the `[[done]]` token (round/directives.ts), which also
//   covers what words alone can't: speech that wasn't meant for her.
// - **Corrections** — "I wasn't done" shortly after any of those closes (or the
//   silence timeout) re-opens the conversation, and is remembered, because
//   Michael expects this to need tuning: a corrected silence lengthens the
//   window, a corrected phrase stops closing, and a brain whose `[[done]]` keeps
//   being corrected stops being trusted with it. Every one of those drifts back
//   as closes go uncorrected, so a single bad evening doesn't stick forever.

export const BASE_WINDOW_MS = 10_000;
/** The longest the follow-up window grows to. Past this the room gets transcribed. */
export const MAX_WINDOW_MS = 22_000;
/** How much one corrected silence-close lengthens the window. */
export const WINDOW_STEP_MS = 4_000;
/** How much the window shrinks back after a run of uncorrected silence-closes. */
export const WINDOW_DECAY_MS = 1_000;
/** Uncorrected closes of one kind that earn back one step (or one strike). */
export const DECAY_AFTER = 6;
/** Corrected `[[done]]`s, net of decay, at which the token stops closing. */
export const MODEL_STRIKES = 3;
/** How long after a close "I wasn't done" still counts as a correction. */
export const CORRECTION_WINDOW_MS = 120_000;

export type ClosingKind = 'dismiss' | 'farewell';

export interface Closing {
  kind: ClosingKind;
  /** The closer phrase that decided it — the unit a correction demotes. */
  phrase: string;
}

/** Why a conversation was closed. */
export type CloseReason = { kind: 'phrase'; phrase: string } | { kind: 'model' } | { kind: 'silence' };

export interface ClosingMemory {
  v: 1;
  /** Current follow-up window, learned. */
  windowMs: number;
  /** Closer phrases that were corrected and no longer close. */
  demoted: string[];
  /** Net corrected `[[done]]`s. */
  modelStrikes: number;
  /** Uncorrected closes since the last step back, per learnable kind. */
  quietSilence: number;
  quietModel: number;
}

export const freshMemory = (): ClosingMemory => ({
  v: 1,
  windowMs: BASE_WINDOW_MS,
  demoted: [],
  modelStrikes: 0,
  quietSilence: 0,
  quietModel: 0,
});

/** A stored memory, or a fresh one when it is missing, old or garbled. */
export function parseMemory(raw: string | null): ClosingMemory {
  if (!raw) return freshMemory();
  try {
    const m = JSON.parse(raw) as Partial<ClosingMemory>;
    if (m?.v !== 1) return freshMemory();
    const f = freshMemory();
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
    return {
      v: 1,
      windowMs: Math.min(MAX_WINDOW_MS, Math.max(BASE_WINDOW_MS, num(m.windowMs, f.windowMs))),
      demoted: Array.isArray(m.demoted) ? m.demoted.filter((p): p is string => typeof p === 'string') : [],
      modelStrikes: Math.max(0, num(m.modelStrikes, 0)),
      quietSilence: Math.max(0, num(m.quietSilence, 0)),
      quietModel: Math.max(0, num(m.quietModel, 0)),
    };
  } catch {
    return freshMemory();
  }
}

/** Whether a `[[done]]` from a brain is still allowed to close the conversation. */
export const trustsModel = (m: ClosingMemory) => m.modelStrikes < MODEL_STRIKES;

// ---------------------------------------------------------------------------
// Reading an utterance

const DISMISS = [
  'never mind',
  'nevermind',
  'forget it',
  'forget about it',
  "that's all",
  'that is all',
  "that's it",
  'that is it',
  "that'll be all",
  'that will be all',
  "that's everything",
  "that's all i needed",
  "that's all i need",
  "that's all i wanted",
  'nothing',
  'nothing else',
  "i'm done",
  'i am done',
  "we're done",
  'stop listening',
  'you can stop listening',
  "i'm good",
  "i'm all set",
  'all set',
  'all good',
];

const FAREWELL = [
  'thanks',
  'thank you',
  'thank you very much',
  'thanks a lot',
  'thanks a bunch',
  'cheers',
  'much appreciated',
  'appreciate it',
  'i appreciate it',
  'good night',
  'goodnight',
  'night night',
  'night',
  'bye',
  'bye bye',
  'goodbye',
  'good bye',
  'see you',
  'see ya',
  'see you later',
  'see you tomorrow',
  'later',
  'talk to you later',
  'talk later',
  'catch you later',
  'have a good one',
  'have a good night',
  'sleep well',
  'no thanks',
  'no thank you',
];

/** Words that ride along with a sign-off without making it a question. */
const FILLER = [
  'ok',
  'okay',
  'okey dokey',
  'alright',
  'all right',
  'great',
  'cool',
  'perfect',
  'awesome',
  'nice',
  'good',
  'lovely',
  'brilliant',
  'excellent',
  'got it',
  'sounds good',
  'that helps',
  "that's great",
  "that's perfect",
  "that's good",
  'that was helpful',
  'so',
  'well',
  'um',
  'uh',
  'oh',
  'yeah',
  'yep',
  'eva',
  'ava',
  'hey',
  'then',
  'for now',
  'for today',
  'so much',
  'very much',
  'again',
  'really',
  'actually',
  'and',
  'you',
];

type Piece = { text: string; words: string[]; kind: ClosingKind | 'filler' };

const PIECES: Piece[] = [
  ...DISMISS.map((t) => ({ text: t, kind: 'dismiss' as const })),
  ...FAREWELL.map((t) => ({ text: t, kind: 'farewell' as const })),
  ...FILLER.map((t) => ({ text: t, kind: 'filler' as const })),
]
  .map((p) => ({ ...p, words: p.text.split(' ') }))
  // Longest first, so "thank you very much" isn't read as "thank you" + junk.
  .sort((a, b) => b.words.length - a.words.length);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * A whole-utterance sign-off, or null. Any farewell makes it a farewell (she
 * answers "that's all, thanks"); otherwise any dismissal makes it a dismissal.
 * A demoted phrase is still consumed — so it doesn't turn the rest into a
 * question — but no longer counts as a closer.
 */
export function readClosing(text: string, demoted: readonly string[] = []): Closing | null {
  const w = words(text);
  if (w.length === 0) return null;
  let i = 0;
  let farewell: string | null = null;
  let dismiss: string | null = null;
  while (i < w.length) {
    const hit = PIECES.find((p) => p.words.every((pw, k) => w[i + k] === pw));
    if (!hit) return null; // a word that isn't a sign-off: this is a question
    i += hit.words.length;
    if (hit.kind === 'filler' || demoted.includes(hit.text)) continue;
    if (hit.kind === 'farewell') farewell ??= hit.text;
    else dismiss ??= hit.text;
  }
  if (farewell) return { kind: 'farewell', phrase: farewell };
  if (dismiss) return { kind: 'dismiss', phrase: dismiss };
  return null;
}

const CORRECTION_RE =
  /^\s*(?:(?:no|wait|hey|eva|hold on|sorry|um|oh)[\s,.!]+)*(?:i\s*(?:'m|am|was)\s*(?:not|n't)\s*(?:done|finished)(?:\s*yet)?|i\s*wasn'?t\s*(?:done|finished)(?:\s*yet)?|i\s*was\s*still\s*(?:talking|going)|not\s*(?:done|finished)\s*yet|you\s*cut\s*me\s*off|come\s*back|don'?t\s*go)\s*(?:$|[,.!?;:—–-][\s,.!?;:—–-]*)/i;

/**
 * "I wasn't done" (and its cousins), at the start of an utterance. `rest` is
 * whatever came after it — "I wasn't done, what about Friday?" corrects *and*
 * asks — and is empty when the correction was all there was. It must end the
 * utterance or be set off by punctuation: "I'm not done with the report" is a
 * sentence about the report, not a correction.
 */
export function readCorrection(text: string): { rest: string } | null {
  const t = text.replace(/[’‘]/g, "'");
  const m = CORRECTION_RE.exec(t);
  if (!m) return null;
  return { rest: t.slice(m[0].length).trim() };
}

// ---------------------------------------------------------------------------
// Learning

/** A close went uncorrected long enough to count as right. */
export function learnFromClose(m: ClosingMemory, reason: CloseReason): ClosingMemory {
  if (reason.kind === 'silence') {
    const quiet = m.quietSilence + 1;
    if (quiet < DECAY_AFTER) return { ...m, quietSilence: quiet };
    return { ...m, quietSilence: 0, windowMs: Math.max(BASE_WINDOW_MS, m.windowMs - WINDOW_DECAY_MS) };
  }
  if (reason.kind === 'model') {
    const quiet = m.quietModel + 1;
    if (quiet < DECAY_AFTER) return { ...m, quietModel: quiet };
    return { ...m, quietModel: 0, modelStrikes: Math.max(0, m.modelStrikes - 1) };
  }
  return m;
}

/** He said "I wasn't done" after a close for `reason`. */
export function learnFromCorrection(m: ClosingMemory, reason: CloseReason): ClosingMemory {
  switch (reason.kind) {
    case 'silence':
      return { ...m, quietSilence: 0, windowMs: Math.min(MAX_WINDOW_MS, m.windowMs + WINDOW_STEP_MS) };
    case 'model':
      return { ...m, quietModel: 0, modelStrikes: m.modelStrikes + 1 };
    case 'phrase':
      return m.demoted.includes(reason.phrase) ? m : { ...m, demoted: [...m.demoted, reason.phrase] };
  }
}

/** For the transcript: what closed it. */
export function describeClose(reason: CloseReason): string {
  switch (reason.kind) {
    case 'phrase':
      return `"${reason.phrase}"`;
    case 'model':
      return 'she judged it over';
    case 'silence':
      return 'silence';
  }
}

/** For the transcript: what a correction taught. */
export function describeLesson(reason: CloseReason, after: ClosingMemory): string {
  switch (reason.kind) {
    case 'phrase':
      return `"${reason.phrase}" no longer ends a conversation`;
    case 'model':
      return trustsModel(after)
        ? `noted (${after.modelStrikes}/${MODEL_STRIKES} before she stops ending conversations herself)`
        : 'she no longer ends conversations herself';
    case 'silence':
      return `follow-up window now ${Math.round(after.windowMs / 1000)}s`;
  }
}

/** The line she says when told she closed too early — then the mic opens. */
export const REOPEN_LINE = 'Sorry — go on.';
