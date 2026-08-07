// Pure wake-phrase matching for "Hey Eva" — no React, unit-tested.
//
// Interim transcripts from the recognizer are noisy: casing and punctuation
// vary, "Eva" is often heard as "Ava"/"Iva"/"Evah", and a fast utterance can
// fuse the words ("heyva"). Matching runs on normalized text and accepts
// those variants, but requires the hey-prefix so bare "Eva"/"Ava" in ordinary
// conversation can't trigger.

export interface WakeMatch {
  /** The matched phrase with ~20 chars of surrounding context, for the log. */
  snippet: string;
}

/**
 * Only this many trailing normalized chars are scanned per result event.
 * On iOS 17- the interim transcript accumulates for the whole session; a
 * single event only ever appends a few words, so bounding the scan keeps
 * per-event cost flat without missing anything new.
 */
export const TAIL_WINDOW = 60;

const CONTEXT_CHARS = 20;

export const WAKE_RE = /\b(?:hey|hay|hei|hea)\s*(?:eva|evah|evas|ava|avah|iva|va)\b/;

export function normalizeWake(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findWake(raw: string): WakeMatch | null {
  const norm = normalizeWake(raw);
  let offset = Math.max(0, norm.length - TAIL_WINDOW);
  // If the window cuts a word ("…then |they ava…" → "hey ava"), the slice
  // start would masquerade as a word boundary; advance to the next real one.
  if (offset > 0 && norm[offset - 1] !== ' ') {
    const nextSpace = norm.indexOf(' ', offset);
    offset = nextSpace === -1 ? norm.length : nextSpace + 1;
  }
  const tail = norm.slice(offset);
  const m = WAKE_RE.exec(tail);
  if (!m) return null;
  const start = offset + m.index;
  const end = start + m[0].length;
  return {
    snippet: norm.slice(Math.max(0, start - CONTEXT_CHARS), Math.min(norm.length, end + CONTEXT_CHARS)),
  };
}
