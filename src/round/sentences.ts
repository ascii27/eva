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

/**
 * Index just past the first sentence terminator that is followed by
 * whitespace, or -1. Requiring following whitespace is what keeps decimals
 * ("3.50") and a terminator still at the end of the buffer intact — the latter
 * because more input could still extend it ("Hello." → "Hello...").
 */
function splitIndex(text: string): number {
  for (let i = 0; i < text.length - 1; i++) {
    if (!SENTENCE_END.includes(text[i])) continue;
    if (/\s/.test(text[i + 1])) return i + 1;
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
