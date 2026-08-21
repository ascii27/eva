// The context bundle: policy only — no React, no I/O, unit-tested.
//
// hermes-agent sends down JSON; this file decides what it means, what it costs,
// how old it is allowed to get, and what it looks like in the prompt. All the
// timing and side effects live in useBundle.ts, the same split history.ts and
// proactive.ts already use.
//
// Two decisions here are load-bearing and easy to undo by accident:
//
// 1. THE CORE CARRIES NO TIMESTAMP. Freshness is rendered separately, from the
//    device's own clock, so a refresh that changed nothing produces a
//    byte-identical core and leaves OpenAI's cached prefix intact. Putting the
//    age back into renderCore would quietly cost the caching discount on every
//    refresh — see the message-layout note in history.ts.
//
// 2. ABSENT AND EMPTY ARE DIFFERENT, all the way through. `null` means hermes
//    never told us; `[]` means it told us there is nothing. "You have nothing
//    this afternoon" and "I don't know what you have this afternoon" are
//    different sentences, and collapsing them is how an appliance starts lying
//    confidently. Every section is `string[] | null` for that reason alone.

import { estimateTokens } from '../agent/history';

/** A section hermes never sent is null; one it sent as empty is []. */
export type Section = string[] | null;

export interface Bundle {
  /** Epoch ms, from the ISO stamp. Never absent — see parseBundle. */
  generatedAt: number;
  identity: Section;
  temporal: { timezone: string | null; dayContext: string | null };
  goals: Section;
  calendar: { next12h: Section; next72h: Section };
  tasks: { today: Section; overdue: Section; deferred: Section };
  people: Section;
  decisions: Section;
  openLoops: { waitingOn: Section; owes: Section };
}

export type Staleness = 'fresh' | 'stale' | 'outOfSync';

/** Past this, Eva hedges on time-sensitive recall. */
export const STALE_AFTER_MS = 10 * 60_000;
/** Past this, she says she is out of sync instead of asserting specifics. */
export const OUT_OF_SYNC_AFTER_MS = 30 * 60_000;

/**
 * What the core is allowed to cost. Enforced by truncation rather than by
 * asking hermes nicely, because a model given a token ceiling does not keep to
 * it and the device is the only party here that can count.
 */
export const CORE_BUDGET_TOKENS = 2_500;

/** Refresh cadence while someone has been in the room recently. */
export const REFRESH_ACTIVE_MS = 150_000;
/** …and once they have not. */
export const REFRESH_QUIET_MS = 15 * 60_000;
/** How long a silence has to run before the slow cadence takes over. */
export const QUIET_AFTER_MS = 60 * 60_000;

/**
 * Sections truncation is allowed to eat, worst-first, with the accessor for
 * each. Everything absent from this list is untouchable: identity, temporal,
 * goals, and the next twelve hours are the whole reason the bundle exists.
 *
 * Within `tasks` the order runs deferred → overdue → today, since a thing he
 * deliberately put off is the least likely to come up out loud.
 */
const DROP_ORDER: { get(b: Bundle): Section; set(b: Bundle, s: Section): void }[] = [
  { get: (b) => b.people, set: (b, s) => void (b.people = s) },
  { get: (b) => b.decisions, set: (b, s) => void (b.decisions = s) },
  { get: (b) => b.openLoops.owes, set: (b, s) => void (b.openLoops.owes = s) },
  { get: (b) => b.openLoops.waitingOn, set: (b, s) => void (b.openLoops.waitingOn = s) },
  { get: (b) => b.tasks.deferred, set: (b, s) => void (b.tasks.deferred = s) },
  { get: (b) => b.tasks.overdue, set: (b, s) => void (b.tasks.overdue = s) },
  { get: (b) => b.tasks.today, set: (b, s) => void (b.tasks.today = s) },
  { get: (b) => b.calendar.next72h, set: (b, s) => void (b.calendar.next72h = s) },
];

/** Top-level keys that make an object a bundle rather than some other JSON. */
const SECTION_KEYS = [
  'identity',
  'temporal',
  'goals',
  'calendar',
  'tasks',
  'people',
  'decisions',
  'openLoops',
  'pendingOps',
];

/**
 * The first balanced `{…}` in the text, honouring string literals so a brace
 * inside a quoted meeting title cannot end the object early.
 *
 * One mechanism covers every wrapping hermes might use — a bare object, a
 * fenced code block, or an object with "Sure, here you go" in front of it.
 */
function extractObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

/** Present-and-usable strings, or null. Anything else in the array is dropped. */
function section(value: unknown): Section {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A bundle, or null.
 *
 * Null rather than a partial, deliberately and in three separate cases: no
 * readable JSON, no readable stamp, or an object carrying no recognised section
 * at all. Each is a response we cannot trust, and the caller's answer to null is
 * to keep serving the bundle it already has — older, but correctly dated, so
 * everything downstream stays honest about it. There is no path from here to an
 * empty bundle, which is the one outcome that would let Eva describe a free
 * afternoon she knows nothing about.
 *
 * The third case is what separates "hermes says the day is empty" from "hermes
 * returned `{error: …}`" — both are objects with no content, and only one of
 * them should reach the prompt.
 */
export function parseBundle(raw: string): Bundle | null {
  const json = extractObject(raw ?? '');
  if (!json) return null;

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const stamp = typeof obj.generatedAt === 'string' ? Date.parse(obj.generatedAt) : NaN;
  if (Number.isNaN(stamp)) return null;
  if (!SECTION_KEYS.some((k) => k in obj)) return null;

  return {
    generatedAt: stamp,
    identity: section(obj.identity),
    temporal: {
      timezone: text(field(obj.temporal, 'timezone')),
      dayContext: text(field(obj.temporal, 'dayContext')),
    },
    goals: section(obj.goals),
    calendar: {
      next12h: section(field(obj.calendar, 'next12h')),
      next72h: section(field(obj.calendar, 'next72h')),
    },
    tasks: {
      today: section(field(obj.tasks, 'today')),
      overdue: section(field(obj.tasks, 'overdue')),
      deferred: section(field(obj.tasks, 'deferred')),
    },
    people: section(obj.people),
    decisions: section(obj.decisions),
    openLoops: {
      waitingOn: section(field(obj.openLoops, 'waitingOn')),
      owes: section(field(obj.openLoops, 'owes')),
    },
  };
}

function clone(b: Bundle): Bundle {
  return {
    ...b,
    temporal: { ...b.temporal },
    calendar: { ...b.calendar },
    tasks: { ...b.tasks },
    openLoops: { ...b.openLoops },
  };
}

/**
 * Trim the bundle down to CORE_BUDGET_TOKENS, worst section first.
 *
 * Entry by entry from the end rather than section by section, so an overrun
 * costs the least it can. A section emptied this way stays `[]` and never
 * becomes `null`: truncation must not be able to turn "no meetings" into "I was
 * never told about your meetings".
 *
 * Recomputing the render on each pop is quadratic and entirely fine — a bundle
 * is dozens of short lines, and the alternative is a second cost model that can
 * disagree with the renderer.
 */
export function budgetCore(bundle: Bundle): Bundle {
  if (estimateTokens(renderCore(bundle)) <= CORE_BUDGET_TOKENS) return bundle;

  const cut = clone(bundle);
  for (const slot of DROP_ORDER) {
    const entries = slot.get(cut);
    if (!entries || entries.length === 0) continue;
    const kept = [...entries];
    while (kept.length && estimateTokens(renderCore(cut)) > CORE_BUDGET_TOKENS) {
      kept.pop();
      slot.set(cut, kept);
    }
    if (estimateTokens(renderCore(cut)) <= CORE_BUDGET_TOKENS) break;
  }
  return cut;
}

/**
 * One section as prose. `null` yields nothing at all; `[]` yields the sentence
 * that says so, because being told there is nothing on is an answer.
 */
function block(heading: string, entries: Section, empty: string): string[] {
  if (entries === null) return [];
  if (entries.length === 0) return [empty];
  return [`${heading}:`, ...entries.map((e) => `- ${e}`)];
}

/**
 * The stable half of the bundle, as it appears in the prompt.
 *
 * Contains nothing derived from the current time — see the header note. Bullets
 * are fine here: this is input, and history.ts already lays the memory block out
 * the same way. What Eva must not *emit* is a separate matter, handled by the
 * persona and the flattener.
 */
export function renderCore(bundle: Bundle): string {
  const lines: string[] = [
    'What your other half knows about Michael and his week. Answer from this directly — it is already yours, and there is no tool to look any of it up with.',
  ];

  const { timezone, dayContext } = bundle.temporal;
  if (dayContext || timezone) {
    lines.push('', [dayContext && `Today is a ${dayContext}.`, timezone && `He is in ${timezone}.`].filter(Boolean).join(' '));
  }
  if (bundle.identity?.length) lines.push('', ...bundle.identity);

  const sections: [string, Section, string][] = [
    ['Goals and commitments', bundle.goals, 'No active goals on the board.'],
    ['Next twelve hours', bundle.calendar.next12h, 'Nothing scheduled in the next twelve hours.'],
    ['Later this week', bundle.calendar.next72h, 'Nothing else scheduled in the next three days.'],
    ['Due today', bundle.tasks.today, 'Nothing due today.'],
    ['Overdue', bundle.tasks.overdue, 'Nothing overdue.'],
    ['Put off deliberately', bundle.tasks.deferred, ''],
    ['People and open threads', bundle.people, ''],
    ['Decided recently', bundle.decisions, ''],
    ['He is waiting on', bundle.openLoops.waitingOn, ''],
    ['He owes someone', bundle.openLoops.owes, ''],
  ];
  for (const [heading, entries, empty] of sections) {
    // A section with no natural empty sentence contributes nothing when empty;
    // "he owes nobody anything" is not worth the tokens or the risk.
    const rendered = block(heading, entries, empty).filter((l) => l !== '');
    if (rendered.length) lines.push('', ...rendered);
  }

  return lines.join('\n');
}

export function staleness(generatedAt: number, now: number): Staleness {
  const age = Math.max(0, now - generatedAt);
  if (age >= OUT_OF_SYNC_AFTER_MS) return 'outOfSync';
  if (age >= STALE_AFTER_MS) return 'stale';
  return 'fresh';
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

/** Small numbers as words, so the age reads the way Eva is asked to speak. */
function spell(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 60) return ONES[n % 10] === 'zero' ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`;
  return String(n);
}

/** How old the picture is, said out loud. */
function describeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'This picture is current, as of a moment ago.';
  if (minutes === 1) return 'This picture was put together a minute ago.';
  if (minutes < 60) return `This picture was put together ${spell(minutes)} minutes ago.`;
  const hours = Math.floor(minutes / 60);
  return hours === 1
    ? 'This picture was put together over an hour ago.'
    : `This picture was put together about ${spell(hours)} hours ago.`;
}

/**
 * The volatile half: how old the picture is and what that means for how she
 * should talk about it.
 *
 * Deliberately small and deliberately last of the system messages, because it
 * changes on every refresh and everything above it should not have to.
 *
 * A stamp from the future — clock skew between the phone and the hermes host —
 * reads as age zero rather than as a negative, which would otherwise make a
 * skewed bundle look permanently, and wrongly, fresh in a way nothing detects.
 */
export function renderVolatile(bundle: Bundle, now: number): string {
  const age = Math.max(0, now - bundle.generatedAt);
  const lines = [describeAge(age)];

  switch (staleness(bundle.generatedAt, now)) {
    case 'stale':
      lines.push(
        'It is old enough that anything time-sensitive in it may have moved since. Say what you know and say when it is from — "as of a few minutes ago, you had" — rather than stating it flat.',
      );
      break;
    case 'outOfSync':
      lines.push(
        'That is long enough that you are out of sync with your other half. Say so plainly if he asks about his calendar or his tasks, and do not state what is on either of them as fact.',
      );
      break;
    case 'fresh':
      break;
  }
  return lines.join('\n');
}

/**
 * How long to wait before the next refresh.
 *
 * The harness spec says a flat 150 seconds. That is right while someone is in
 * the room and wrong overnight: a flat cadence is ~576 hermes runs a day, each a
 * full agent run with tools, most of them at three in the morning for nobody.
 * A silence of an hour drops it to the slow cadence; anything said picks it back
 * up on the next tick.
 *
 * `lastInteractionAt` of 0 — nothing has happened since launch — reads as quiet
 * rather than as infinitely recent.
 */
export function refreshInterval(now: number, lastInteractionAt: number): number {
  return now - lastInteractionAt < QUIET_AFTER_MS ? REFRESH_ACTIVE_MS : REFRESH_QUIET_MS;
}

/** Rough cost of the bundle in the prompt, for the overlay and the transcript. */
export function coreTokens(bundle: Bundle): number {
  return estimateTokens(renderCore(bundle));
}
