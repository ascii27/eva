// When Eva sleeps at the desk (ASC-33). Pure policy, no React and no native
// modules: useSleep owns the clock and the screen brightness.
//
// Night is the sleepy-hour window (22:00–06:00, SLEEPY_START/END_HOUR). In it
// she is dimmed; after SLEEP_AFTER_MS of quiet she also looks asleep, and the
// screen goes darker still. Anything that happens — a wake, a touch, a
// message she speaks — brightens her for the conversation, and the quiet
// clock restarts when it's over. Quiet only counts from the start of the
// night, so at 22:00 she dims first and dozes off ten minutes later rather
// than falling straight asleep because the evening was quiet.

import { isSleepyHour } from './geometry';
import { SLEEPY_START_HOUR } from './constants';

export type SleepPhase = 'awake' | 'dim' | 'asleep';

/** Quiet time at night before she looks asleep. */
export const SLEEP_AFTER_MS = 10 * 60_000;
/** After a conversation or a touch at night, stay bright this long before dimming. */
export const NIGHT_AWAKE_GRACE_MS = 60_000;

/** Screen brightness (0–1) by phase; never brighter than the daytime level. */
export const NIGHT_TALK_BRIGHTNESS = 0.5;
export const DIM_BRIGHTNESS = 0.1;
export const ASLEEP_BRIGHTNESS = 0.02;

/** Local time of the night window's most recent start (22:00), in ms. */
export function nightStart(now: Date): number {
  const d = new Date(now);
  if (d.getHours() < SLEEPY_START_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(SLEEPY_START_HOUR, 0, 0, 0);
  return d.getTime();
}

/**
 * The phase at `now`, given whether a round is under way (`busy`) and when
 * anything last happened (`lastActive`, ms).
 */
export function sleepPhase(now: Date, busy: boolean, lastActive: number): SleepPhase {
  if (!isSleepyHour(now.getHours())) return 'awake';
  const t = now.getTime();
  if (busy || t - lastActive < NIGHT_AWAKE_GRACE_MS) return 'awake';
  const quiet = t - Math.max(lastActive, nightStart(now));
  return quiet >= SLEEP_AFTER_MS ? 'asleep' : 'dim';
}

/** Screen brightness for a night phase, capped at the daytime level `day`. */
export function nightBrightness(phase: SleepPhase, day: number): number {
  const level = phase === 'asleep' ? ASLEEP_BRIGHTNESS : phase === 'dim' ? DIM_BRIGHTNESS : NIGHT_TALK_BRIGHTNESS;
  return Math.min(day, level);
}

/** "Stay awake" from a wake_up holds her bright this long before night resumes. */
export const WAKE_HOLD_MS = 30 * 60_000;

/**
 * What she was told, as opposed to what the clock says. `asleep` lasts until
 * anything happens — a round, a touch, the overlay; `awake` lasts until `until`
 * and then the night picks up as if that were the last activity.
 */
export type SleepRequest = { kind: 'asleep' } | { kind: 'awake'; until: number } | null;

/**
 * The phase once a spoken or hermes-sent request is taken into account.
 *
 * `away` is presence (ASC-47): nobody has been at the desk for
 * AWAY_SLEEP_MS, so she sleeps at any hour. It ranks below being told to stay
 * up — that was an explicit instruction — and below a round, which means
 * someone is talking to her whatever the camera thinks.
 */
export function requestedPhase(
  now: Date,
  busy: boolean,
  lastActive: number,
  request: SleepRequest,
  away = false,
): SleepPhase {
  if (busy) return 'awake';
  if (request?.kind === 'asleep') return 'asleep';
  if (request?.kind === 'awake') {
    if (now.getTime() < request.until) return 'awake';
    if (away) return 'asleep';
    return sleepPhase(now, false, Math.max(lastActive, request.until));
  }
  if (away) return 'asleep';
  return sleepPhase(now, false, lastActive);
}
