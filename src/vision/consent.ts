// Reading a spoken yes or no — pure, no React, no I/O.
//
// This is the whole guarantee behind "Eva always asks before using the
// camera". The gate is machine-enforced rather than a persona instruction, so
// this function decides whether a lens opens in a room. Two rules follow from
// that and are not stylistic:
//
// 1. Anything that isn't a clear yes is not a yes. Silence, a garbled
//    transcript, and someone talking about something else all come back
//    `unclear`, which re-asks once and then gives up.
// 2. A refusal beats an affirmative anywhere in the same utterance. "No, don't
//    do it" contains "do"; hearing that as permission would be the worst bug
//    this file could have.
//
// Matching is on whole words. Substring matching reads "yes" out of "eyes" and
// "no" out of "know" — both ordinary words in a room with an open mic.

export type Consent = 'yes' | 'no' | 'unclear';

/**
 * Spoken when the model called the camera tool without emitting a preamble of
 * its own — `gpt-4o-mini` does this 0/6 of the time (see models.ts). Consent
 * you cannot hear is not consent, so something always gets asked out loud.
 */
export const CONSENT_QUESTION = 'Mind if I take a look through the camera?';

/** Asked once more after an answer that was neither yes nor no. */
export const CONSENT_RETRY = 'Sorry — is that a yes?';

// Multi-word phrases are checked as phrases; single words as whole words.
const YES = [
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'fine',
  'please',
  'go ahead',
  'go for it',
  'do it',
  'of course',
  'take a look',
  'have a look',
];

const NO = [
  'no',
  'nope',
  'nah',
  'stop',
  'wait',
  'later',
  'dont',
  // Bare `not` covers the long tail of negations without enumerating them —
  // "not ok", "not yet", "not sure", "not really". It costs us "why not",
  // which is an English yes read here as a refusal. That trade is deliberate
  // and always in the same direction: a misread refusal asks again, a misread
  // consent opens the lens.
  'not',
  'no thanks',
  'hold on',
  'never mind',
  'nevermind',
];

/**
 * Lowercase, strip everything that isn't a letter, digit or space, and collapse
 * runs of whitespace. Apostrophes are dropped rather than replaced, which is
 * what turns both "don't" and "don’t" into the single token `dont` — iOS
 * dictation emits the curly one.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word (or whole-phrase) containment, so "eyes" never matches "yes". */
function has(haystack: string, needle: string): boolean {
  return new RegExp(`(?:^| )${needle.replace(/ /g, ' ')}(?:$| )`).test(haystack);
}

export function readConsent(transcript: string): Consent {
  const text = normalize(transcript);
  if (!text) return 'unclear';

  // Order matters: a refusal wins over any affirmative in the same breath.
  if (NO.some((phrase) => has(text, phrase))) return 'no';
  if (YES.some((phrase) => has(text, phrase))) return 'yes';
  return 'unclear';
}
