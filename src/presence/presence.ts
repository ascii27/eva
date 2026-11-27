// Whether someone is at the desk (ASC-47). Pure policy, no React and no native
// modules: usePresence owns the camera and the clock.
//
// The only input is a face count from Apple Vision, run on the device by the
// EvaPresence native module — no image ever reaches JS, let alone the network.
// The count is raw and twitchy: a head turned to a second monitor is zero
// faces, someone walking behind the chair is two. Everything here is about
// turning that into the three things the face acts on:
//
//   here   — someone has been in front of her for a moment (not a glimpse)
//   busy   — more than one person, for more than a moment
//   away   — nobody, for long enough that she should sleep
//
// Who it is is deliberately not a question this file can answer.

/** A face must be held this long to count as someone arriving — not a passer-by. */
export const ARRIVE_AFTER_MS = 2_000;
/** No face this long and they've gone. Long, because looking away is zero faces. */
export const GONE_AFTER_MS = 30_000;
/** Two or more faces held this long and the room is busy. */
export const BUSY_AFTER_MS = 5_000;
/** The room stays busy until it has been down to one person this long. */
export const BUSY_CLEAR_MS = 60_000;
/** Nobody for this long and she goes to sleep, at any hour (Michael, Nov 27). */
export const AWAY_SLEEP_MS = 15 * 60_000;
/** Only an arrival after at least this long away is worth a greeting. */
export const GREET_AFTER_AWAY_MS = 10 * 60_000;
/** And never twice inside this window, however often someone comes and goes. */
export const GREET_COOLDOWN_MS = 30 * 60_000;

export interface PresenceState {
  /** Latest raw count from the detector. */
  faces: number;
  /** Debounced: someone is at the desk. */
  here: boolean;
  /** Debounced: two or more people. */
  busy: boolean;
  /** When the current unbroken run of ≥1 faces began, or null. */
  seenSince: number | null;
  /** Last time any face was seen, or null since watching started. */
  lastSeen: number | null;
  /** When `here` last went false — or watching started, which is all we know. */
  goneSince: number;
  /** When the current unbroken run of ≥2 faces began, or null. */
  manySince: number | null;
  /** Last time two or more faces were seen. */
  lastMany: number | null;
}

export type PresenceEvent =
  | { kind: 'arrived'; awayMs: number }
  | { kind: 'left' }
  | { kind: 'busy' }
  | { kind: 'quiet' };

/**
 * Watching just started (or restarted after a pause). Nobody is assumed here,
 * and absence is counted from now: before this the camera was off, so the
 * honest away time is zero — which is also why a launch never greets.
 */
export function initialPresence(now: number): PresenceState {
  return {
    faces: 0,
    here: false,
    busy: false,
    seenSince: null,
    lastSeen: null,
    goneSince: now,
    manySince: null,
    lastMany: null,
  };
}

/**
 * Advance to `now`. `faces` is a new count from the detector; omit it on a
 * clock tick, since the native side only reports changes and the last count
 * still stands.
 */
export function step(
  s: PresenceState,
  now: number,
  faces?: number,
): { state: PresenceState; events: PresenceEvent[] } {
  const n = faces ?? s.faces;
  const events: PresenceEvent[] = [];

  const seenSince = n > 0 ? (s.faces > 0 && s.seenSince !== null ? s.seenSince : now) : null;
  // The detector only reports changes, so a count that just dropped was still
  // true until this moment: the face was seen right up to now.
  const lastSeen = n > 0 || s.faces > 0 ? now : s.lastSeen;
  const manySince = n >= 2 ? (s.faces >= 2 && s.manySince !== null ? s.manySince : now) : null;
  const lastMany = n >= 2 || s.faces >= 2 ? now : s.lastMany;

  let { here, busy, goneSince } = s;
  if (!here && seenSince !== null && now - seenSince >= ARRIVE_AFTER_MS) {
    here = true;
    events.push({ kind: 'arrived', awayMs: Math.max(0, seenSince - s.goneSince) });
  } else if (here && n === 0 && lastSeen !== null && now - lastSeen >= GONE_AFTER_MS) {
    here = false;
    // They left when they were last seen, not when we gave up waiting.
    goneSince = lastSeen;
    events.push({ kind: 'left' });
  }

  if (!busy && manySince !== null && now - manySince >= BUSY_AFTER_MS) {
    busy = true;
    events.push({ kind: 'busy' });
  } else if (busy && n < 2 && (lastMany === null || now - lastMany >= BUSY_CLEAR_MS)) {
    busy = false;
    events.push({ kind: 'quiet' });
  }

  return { state: { faces: n, here, busy, seenSince, lastSeen, goneSince, manySince, lastMany }, events };
}

/** Nobody has been at the desk for AWAY_SLEEP_MS: time to sleep. */
export function isAway(s: PresenceState, now: number): boolean {
  return !s.here && now - s.goneSince >= AWAY_SLEEP_MS;
}

/**
 * What to say to someone sitting down, or null to stay quiet. Generic on
 * purpose: presence says *someone* is here, never who.
 *
 * Quiet when the room is busy — a greeting is for one person settling in, not
 * a meeting — after a short absence, and inside the cooldown. The first
 * greeting of the day is by the clock; later ones are a welcome back.
 */
export function greetingFor(opts: {
  awayMs: number;
  busy: boolean;
  now: Date;
  lastGreetAt: number | null;
}): string | null {
  const { awayMs, busy, now, lastGreetAt } = opts;
  if (busy || awayMs < GREET_AFTER_AWAY_MS) return null;
  const t = now.getTime();
  if (lastGreetAt !== null && t - lastGreetAt < GREET_COOLDOWN_MS) return null;

  const greetedToday = lastGreetAt !== null && sameDay(new Date(lastGreetAt), now);
  if (greetedToday) return 'Welcome back.';
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Good morning.';
  if (h >= 12 && h < 18) return 'Good afternoon.';
  if (h >= 18) return 'Good evening.';
  return "Hi. You're up late.";
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
