// The floating question mark (ASC-59 follow-up) — pure, no React, unit-tested.
//
// When Eva finishes a reply that ends on a question, a "?" drifts up beside
// her face: the cue that it's his turn, alongside the waiting look the face
// takes on as the mic opens. Not in the design file yet.

/** Closing quotes and brackets that may trail the question mark. */
const TRAILING = /["'”’)\]\s]+$/;

/**
 * Whether what she just said ends by asking something. Only the *last*
 * sentence counts: "Did it work? It did." is an answer, not a question.
 */
export function endsWithQuestion(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.replace(TRAILING, '').endsWith('?');
}

/** How long the glyph is on screen, rising and fading. */
export const QUESTION_MS = 1900;
/** How far it rises, in design pixels. */
export const QUESTION_RISE = 46;
/** Its size, in design pixels. */
export const QUESTION_SIZE = 72;
