// Whether someone is at the desk (ASC-47, reworked for battery in ASC-55).
// Pure policy, no React and no native modules: usePresence owns the camera
// and the clock.
//
// The camera is not a stream. Every POLL_INTERVAL_MS the EvaPresence native
// module turns the front camera on for a few seconds, and hands back one
// sample: a held face count from Apple Vision and a motion score from frame
// differences — then turns the camera off again. No image ever reaches JS,
// let alone the network.
//
// Samples are sparse and the raw signals are twitchy: a head turned to a
// second monitor is zero faces, someone walking behind the chair is two.
// Everything here is about turning them into the things the face acts on:
//
//   stirred — motion or a face in this sample: wake the screen, nothing more
//   here    — a face was seen (only a face: motion alone never greets)
//   busy    — more than one person
//   away    — no face and no motion for long enough that she should sleep
//
// Who it is is deliberately not a question this file can answer.

/** How often the camera wakes for a look. Between looks it is off. */
export const POLL_INTERVAL_MS = 15_000;
/**
 * Share of the frame that has to change inside one look to count as motion.
 * Native reports the share (0-1); the threshold lives here so it can be tuned
 * by OTA against the `[presence]` log instead of by rebuild.
 */
export const MOTION_THRESHOLD = 0.02;
/**
 * No face and no motion this long and they've gone — three empty looks.
 * Motion counts, because someone at the desk looking at another monitor is
 * zero faces but rarely perfectly still.
 */
export const GONE_AFTER_MS = 45_000;
/** The room stays busy until no look has shown two faces for this long. */
export const BUSY_CLEAR_MS = 60_000;
/** Nobody for this long and she goes to sleep, at any hour (Michael, Nov 27). */
export const AWAY_SLEEP_MS = 15 * 60_000;
/** Only an arrival after at least this long away is worth a greeting. */
export const GREET_AFTER_AWAY_MS = 10 * 60_000;
/** And never twice inside this window, however often someone comes and goes. */
export const GREET_COOLDOWN_MS = 30 * 60_000;

/**
 * One look. `faces` is already held: native counts a face only if it is in
 * most of the frames of the look, so a glimpse of a passer-by is zero — the
 * job ARRIVE_AFTER_MS did when the camera streamed.
 */
export interface Sample {
  faces: number;
  /** Share of the frame that changed during the look, 0-1. */
  motion: number;
}

export interface PresenceState {
  /** Count from the latest look. */
  faces: number;
  /** Someone is at the desk. */
  here: boolean;
  /** Two or more people. */
  busy: boolean;
  /** Last look with a face in it, or null since watching started. */
  lastSeen: number | null;
  /** Last look with a face or motion in it — or watching starting. */
  lastStir: number;
  /** When `here` last went false — or watching started, which is all we know. */
  goneSince: number;
  /** Last look with two or more faces. */
  lastMany: number | null;
}

export type PresenceEvent =
  | { kind: 'arrived'; awayMs: number }
  | { kind: 'left' }
  | { kind: 'busy' }
  | { kind: 'quiet' }
  | { kind: 'stirred' };

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
    lastSeen: null,
    lastStir: now,
    goneSince: now,
    lastMany: null,
  };
}

/** Whether a look saw anything move. */
export const moved = (sample: Sample): boolean => sample.motion >= MOTION_THRESHOLD;

/**
 * Advance to `now`, with the look just taken; omit it on a clock tick, and
 * the last count stands.
 */
export function step(
  s: PresenceState,
  now: number,
  sample?: Sample,
): { state: PresenceState; events: PresenceEvent[] } {
  const events: PresenceEvent[] = [];
  const faces = sample ? sample.faces : s.faces;
  let { here, busy, lastSeen, lastStir, goneSince, lastMany } = s;

  if (sample) {
    if (faces > 0) lastSeen = now;
    if (faces >= 2) lastMany = now;
    if (faces > 0 || moved(sample)) {
      lastStir = now;
      events.push({ kind: 'stirred' });
    }
  }

  if (!here && sample && faces > 0) {
    // A face in one look is enough: native already insisted it was held, and
    // waiting for a second look would put a greeting 15s after sitting down.
    here = true;
    events.push({ kind: 'arrived', awayMs: Math.max(0, now - goneSince) });
  } else if (here && now - lastStir >= GONE_AFTER_MS) {
    here = false;
    // They left when they were last seen or heard moving, not when we gave up.
    goneSince = lastStir;
    events.push({ kind: 'left' });
  }

  if (!busy && sample && faces >= 2) {
    busy = true;
    events.push({ kind: 'busy' });
  } else if (busy && faces < 2 && (lastMany === null || now - lastMany >= BUSY_CLEAR_MS)) {
    busy = false;
    events.push({ kind: 'quiet' });
  }

  return { state: { faces, here, busy, lastSeen, lastStir, goneSince, lastMany }, events };
}

/**
 * Nobody, and nothing moving, for AWAY_SLEEP_MS: time to sleep. Motion counts
 * here although it never greets — someone walking in should wake the screen.
 */
export function isAway(s: PresenceState, now: number): boolean {
  return !s.here && now - s.lastStir >= AWAY_SLEEP_MS;
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
