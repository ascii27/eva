// "Be more sassy" (ASC-59). Pure: reads a heard transcript for a request to
// change Eva's personality.
//
// Handled on the device before any brain sees the words, exactly like "stop
// watching" (presence/command.ts): it works the same on every brain, costs no
// round trip, and doesn't depend on a model choosing to call a tool. The price
// is that only phrasings aimed squarely at her count — "be more concise in that
// email" must stay a question for the brain, so a nudge has to be the whole
// request, not a clause inside one.

import { PRESETS, TRAIT_POLES, type PresetId, type TraitKey } from './traits';

export type PersonalityCommand =
  | { kind: 'preset'; id: PresetId }
  | { kind: 'nudge'; trait: TraitKey; dir: 1 | -1 }
  | { kind: 'query' };

/** Words for each pole, base form and comparative. dir is toward the high pole. */
const WORDS: Array<{ trait: TraitKey; dir: 1 | -1; words: string[] }> = [
  { trait: 'humor', dir: 1, words: ['funny', 'funnier', 'playful', 'jokey', 'silly', 'sillier', 'humorous', 'witty', 'wittier'] },
  { trait: 'humor', dir: -1, words: ['serious'] },
  { trait: 'warmth', dir: 1, words: ['warm', 'warmer', 'friendly', 'friendlier', 'affectionate', 'nice', 'nicer'] },
  { trait: 'warmth', dir: -1, words: ['cool', 'cooler', 'cold', 'colder', 'professional', 'formal', 'distant'] },
  { trait: 'sass', dir: 1, words: ['sassy', 'sassier', 'cheeky', 'cheekier', 'snarky', 'snarkier', 'sarcastic', 'blunt', 'blunter', 'spicy', 'spicier'] },
  { trait: 'sass', dir: -1, words: ['gentle', 'gentler', 'kind', 'kinder', 'soft', 'softer', 'polite', 'politer'] },
  { trait: 'energy', dir: 1, words: ['energetic', 'upbeat', 'peppy', 'peppier', 'lively', 'livelier', 'excited', 'enthusiastic', 'bubbly', 'bubblier'] },
  { trait: 'energy', dir: -1, words: ['calm', 'calmer', 'chill', 'chiller', 'mellow', 'mellower', 'relaxed', 'laid-back', 'laid back'] },
  { trait: 'chattiness', dir: 1, words: ['chatty', 'chattier', 'talkative', 'conversational', 'wordy', 'wordier'] },
  { trait: 'chattiness', dir: -1, words: ['terse', 'terser', 'brief', 'briefer', 'concise', 'short', 'shorter', 'succinct'] },
  { trait: 'curiosity', dir: 1, words: ['curious', 'inquisitive', 'nosy', 'nosier', 'nosey'] },
  { trait: 'curiosity', dir: -1, words: ['matter-of-fact', 'matter of fact', 'direct', 'to the point'] },
];

// Not "quiet": "be quiet" means stop talking, not change temperament.
//
// Who she is talking to, then an optional softener, then the verb. Anchored at
// the start so the nudge must be the request itself.
const LEAD = String.raw`^(?:(?:hey |hi |ok |okay )?eva,? )?(?:(?:can|could|would|will) you (?:please )?|please |try to |i(?:'d| would)? (?:want|like) you to |i need you to )?`;
const VERB = String.raw`(?:be|get|act|sound|go)`;
const AMOUNT = String.raw`(?:a (?:little|bit|lot|touch|tad|little bit) |a bit |much |way |even |slightly )?`;

/** A word as a pattern where a hyphen and a space are interchangeable. */
function escape(w: string): string {
  return w.split(/[- ]/).join('[- ]');
}

function findWord(w: string): { trait: TraitKey; dir: 1 | -1 } | null {
  const hit = WORDS.find((g) => g.words.some((x) => new RegExp(`^${escape(x)}$`).test(w)));
  return hit ? { trait: hit.trait, dir: hit.dir } : null;
}

const ALL_WORDS = WORDS.flatMap((g) => g.words)
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');

const NUDGE_RE = new RegExp(`${LEAD}${VERB} ${AMOUNT}(more|less)? ?(${ALL_WORDS})\\b`);
// "tone it down", "dial it back" — both read as less of the sass/energy at once,
// but one slider per command keeps the reply honest: energy.
const DOWN_RE = new RegExp(`${LEAD}(?:tone|dial|calm) it (?:down|back)\\b`);

const PRESET_NAMES: Array<{ id: PresetId; re: RegExp }> = [
  { id: 'chief', re: /\b(?:chief(?: of staff)?|normal|default|usual|regular)\b/ },
  { id: 'sunny', re: /\bsunny\b/ },
  { id: 'dry', re: /\bdry(?: wit)?\b/ },
  { id: 'sassy', re: /\bsassy\b/ },
  { id: 'zen', re: /\b(?:zen|calm)\b/ },
  { id: 'focused', re: /\b(?:focused|all business|business)\b/ },
];

const PRESET_RE = new RegExp(
  `${LEAD}(?:(?:switch|change) (?:to|into) |use |go |be |turn on )(?:your |the |a )?(.+?) (?:personality|mode|self)\\b`,
);
const BACK_TO_NORMAL_RE = new RegExp(`${LEAD}(?:go back to|be) (?:your )?(?:normal|usual|old|regular)(?: self| personality)?$`);
const QUERY_RE = /\b(?:what|which) (?:personality|mode) (?:are you|is this|are you in|are you using)\b/;

export function readPersonalityCommand(text: string): PersonalityCommand | null {
  const t = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (QUERY_RE.test(t)) return { kind: 'query' };
  if (BACK_TO_NORMAL_RE.test(t)) return { kind: 'preset', id: 'chief' };

  const p = PRESET_RE.exec(t);
  if (p) {
    const hit = PRESET_NAMES.find((n) => n.re.test(p[1]));
    if (hit) return { kind: 'preset', id: hit.id };
  }

  if (DOWN_RE.test(t)) return { kind: 'nudge', trait: 'energy', dir: -1 };

  const m = NUDGE_RE.exec(t);
  if (!m) return null;
  const found = findWord(m[2]);
  if (!found) return null;
  // "be sassy" with no more/less is taken as more: nobody says "be sassy" to
  // mean stay exactly as sassy as you are.
  const less = m[1] === 'less';
  return { kind: 'nudge', trait: found.trait, dir: less ? (-found.dir as 1 | -1) : found.dir };
}

/**
 * What she says back. Short — the face and the next reply are the
 * confirmation. `atLimit` is a nudge that couldn't move the slider any
 * further, which deserves saying rather than a cheerful "okay".
 */
export function personalityReply(cmd: PersonalityCommand, label: string, atLimit = false): string {
  if (cmd.kind === 'query') return `I'm on ${label} at the moment.`;
  if (cmd.kind === 'preset') return `Okay — ${PRESETS.find((p) => p.id === cmd.id)?.label ?? label} it is.`;
  const [low, high] = TRAIT_POLES[cmd.trait];
  const word = cmd.dir > 0 ? high : low;
  if (atLimit) return `That's as ${word} as I go.`;
  return `Okay — a bit more ${word}.`;
}
