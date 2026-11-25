// Pure wake-phrase matching for "Hey Eva" / "Hi Eva" — no React, unit-tested.
//
// Interim transcripts from the recognizer are noisy: casing and punctuation
// vary, "Eva" is often heard as "Ava"/"Iva"/"Evah", and a fast utterance can
// fuse the words ("heyva"). Matching runs on normalized text and accepts
// those variants, but requires a greeting prefix so bare "Eva"/"Ava" in ordinary
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

// Greeting first, always: "Hi Eva" is how people actually address her (ASC-37),
// but a bare "Eva"/"Ava" in ordinary conversation must never wake her.
export const WAKE_RE = /\b(?:hey|hay|hei|hea|hi|hello|hallo|hiya)\s*(?:eva|evah|evas|ava|avah|iva|va)\b/;

/**
 * What a wake attempt sounds like when the recognizer gets it wrong in a noisy
 * room: an Eva-like word on its own, or a greeting followed by a word that
 * starts the way "Eva" does ("hey ever", "hi even"). Only ever logged, never
 * acted on — it is the evidence for tuning WAKE_RE, and for ASC-39.
 */
const NEAR_RE = /\b(?:(?:hey|hay|hei|hea|hi|hello|hallo|hiya)\s+[aeiou]\w*|eva|evah|evas|ava|iva|eve|ever|evan|ivy)\b/;

export function normalizeWake(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scanTail(raw: string, re: RegExp): WakeMatch | null {
  const norm = normalizeWake(raw);
  let offset = Math.max(0, norm.length - TAIL_WINDOW);
  // If the window cuts a word ("…then |they ava…" → "hey ava"), the slice
  // start would masquerade as a word boundary; advance to the next real one.
  if (offset > 0 && norm[offset - 1] !== ' ') {
    const nextSpace = norm.indexOf(' ', offset);
    offset = nextSpace === -1 ? norm.length : nextSpace + 1;
  }
  const tail = norm.slice(offset);
  const m = re.exec(tail);
  if (!m) return null;
  const start = offset + m.index;
  const end = start + m[0].length;
  return {
    snippet: norm.slice(Math.max(0, start - CONTEXT_CHARS), Math.min(norm.length, end + CONTEXT_CHARS)),
  };
}

export function findWake(raw: string): WakeMatch | null {
  return scanTail(raw, WAKE_RE);
}

/**
 * The recognizer sends up to five guesses per result. In a noisy room the top
 * one is often "heavy a" while "hey eva" sits second — so any of them wakes her.
 */
export function findWakeIn(transcripts: string[]): WakeMatch | null {
  for (const t of transcripts) {
    const m = findWake(t);
    if (m) return m;
  }
  return null;
}

export function findNearMiss(raw: string): WakeMatch | null {
  return findWake(raw) ? null : scanTail(raw, NEAR_RE);
}

/** A near-miss only if no alternative actually woke her. */
export function findNearMissIn(transcripts: string[]): WakeMatch | null {
  if (findWakeIn(transcripts)) return null;
  for (const t of transcripts) {
    const m = scanTail(t, NEAR_RE);
    if (m) return m;
  }
  return null;
}
