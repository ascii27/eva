// How long the side column's SAW thumbnail stays up (ASC-50).
//
// The thumbnail is a receipt for the moment ("this is what I looked at"), not
// a display: anyone in the room can see it, so it comes down on its own. It
// goes a few seconds after the reply has been spoken, and in any case no later
// than THUMBNAIL_MAX_MS after capture — a look that never gets a spoken answer
// (a dropped round, the overlay's test capture) must not leave it up forever.
//
// Only the *display* expires. The photo itself stays in the conversation
// window (`photos.ts`) so a follow-up question can still refer to it.

/** Hard ceiling on how long a captured photo is shown, from capture. */
export const THUMBNAIL_MAX_MS = 30_000;
/** Grace after the reply finishes speaking, so it doesn't vanish mid-glance. */
export const THUMBNAIL_AFTER_REPLY_MS = 3_000;
/** Fade-out duration in the side column. */
export const THUMBNAIL_FADE_MS = 600;

/**
 * When the thumbnail of a photo captured at `capturedAt` should come down.
 *
 * `replyEndedAt` is when the face last stopped speaking, or null. A speech end
 * from *before* the capture is the consent question, not the answer, so it is
 * ignored.
 */
export function thumbnailDeadline(capturedAt: number, replyEndedAt: number | null): number {
  const ceiling = capturedAt + THUMBNAIL_MAX_MS;
  if (replyEndedAt === null || replyEndedAt < capturedAt) return ceiling;
  return Math.min(ceiling, replyEndedAt + THUMBNAIL_AFTER_REPLY_MS);
}
