// Incremental sentence assembly for streamed replies — no React, no I/O,
// unit-tested.
//
// This exists for the *sanitizer*, not for Kokoro. Kokoro partitions its own
// input on sentence boundaries natively, so it would happily accept raw token
// deltas — but speakableFromMrkdwn cannot flatten half a `**bold**` span, and
// feeding it fragments would leak asterisks and urls into the spoken audio. So
// text accumulates here until a sentence is complete, gets flattened once, and
// only then goes to the engine.
//
// Splitting on Kokoro's own terminator set is a second, quieter benefit: every
// push ends on a boundary its partitioner accepts immediately, so its
// mid-sentence fallback (kStreamMaxSkippedIterations, ~600ms) never fires.

import { speakableFromMrkdwn } from './speakable';

/** Kokoro's kEndOfSentenceCharacters (Constants.h) — keep in sync. */
export const SENTENCE_END = '.?!;…';

/**
 * Past this much unterminated text, speak it anyway at the last word boundary.
 * A model that forgets punctuation must not be able to stall the audio.
 */
export const MAX_PENDING_CHARS = 200;

export interface SentenceState {
  /** Text received but not yet emitted as a complete sentence. */
  pending: string;
}

export function emptySentences(): SentenceState {
  return { pending: '' };
}

/** Markdown delimiters that must be balanced before a cut is safe. */
const SPAN_DELIMS = ['*', '_', '~', '`'];

/**
 * True when `text` ends with a markdown construct still open, so flattening it
 * now would leak literal delimiters into the audio.
 *
 * Counts maximal *runs*, not characters: `**bold**` is four asterisks but two
 * runs, and a cut inside it leaves exactly one — whereas a character count would
 * read as balanced and wave the cut through.
 */
function spanOpen(text: string): boolean {
  for (const delim of SPAN_DELIMS) {
    let runs = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== delim) continue;
      runs++;
      while (i + 1 < text.length && text[i + 1] === delim) i++;
    }
    if (runs % 2 === 1) return true;
  }
  // A link's label and target must both be present for the flattener to reduce
  // it to the label alone.
  const opens = (ch: string) => text.split(ch).length - 1;
  return opens('[') !== opens(']') || opens('(') !== opens(')');
}

/**
 * Index just past the first sentence terminator that is followed by
 * whitespace, or -1. Requiring following whitespace is what keeps decimals
 * ("3.50") and a terminator still at the end of the buffer intact — the latter
 * because more input could still extend it ("Hello." → "Hello...").
 */
function splitIndex(text: string): number {
  for (let i = 0; i < text.length - 1; i++) {
    if (!SENTENCE_END.includes(text[i])) continue;
    if (!/\s/.test(text[i + 1])) continue;
    // A terminator inside an open span is not a usable boundary — cutting there
    // would hand the flattener half a construct.
    if (spanOpen(text.slice(0, i + 1))) continue;
    return i + 1;
  }
  return -1;
}

export function pushText(state: SentenceState, text: string): { state: SentenceState; sentences: string[] } {
  let pending = state.pending + text;
  const sentences: string[] = [];

  for (;;) {
    let cut = splitIndex(pending);
    if (cut < 0) {
      if (pending.length <= MAX_PENDING_CHARS) break;
      // Deliberately not span-aware: a stray unmatched delimiter would hold a
      // span open forever, and stalling the audio is worse than one spoken
      // asterisk.
      cut = pending.lastIndexOf(' ', MAX_PENDING_CHARS);
      if (cut <= 0) break; // one unbroken token; a mid-word fragment is worse
    }
    const speakable = speakableFromMrkdwn(pending.slice(0, cut));
    pending = pending.slice(cut);
    if (speakable) sentences.push(speakable);
  }

  return { state: { pending }, sentences };
}

/** Whatever is left when the stream ends, flattened. May be empty. */
export function flushPending(state: SentenceState): string {
  return speakableFromMrkdwn(state.pending);
}
