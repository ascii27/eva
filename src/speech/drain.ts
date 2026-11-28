// How long to wait for a stream that has been ended to finish playing (ASC-67).
//
// Two things end a stream mid-round and wait for it: the consent gate (its
// question must finish before the mic opens) and the cue player (a face or a
// pause lands *after* the words before it). Both used one flat 10s bound,
// sized for the gate's one-sentence question. The cue player's segment can be
// half a reply, and its text runs far ahead of its audio, so at end() most of
// it has yet to play: a long reply with a [[pause]] or [[face]] in it blew the
// bound every time — and what happened next cut off the end of the reply.
//
// The bound exists only for a speech engine that stops reporting (audioOut's
// own watchdog already guarantees Kokoro reports). So it scales with what
// could legitimately still be playing: the text's spoken length, twice over,
// plus the old floor.

/**
 * Kokoro at speed 1.0 speaks roughly this many characters of English a
 * second. Used with a factor of two of slack both here and by the speech trace
 * (cuts.ts), so it needs to be right in magnitude, not in detail.
 */
export const CHARS_PER_SECOND = 15;

export const DRAIN_FLOOR_MS = 10_000;

/** Longest to wait for `chars` of handed-over text to finish playing. */
export function drainBoundMs(chars: number): number {
  return DRAIN_FLOOR_MS + Math.round((Math.max(0, chars) / CHARS_PER_SECOND) * 2 * 1000);
}
