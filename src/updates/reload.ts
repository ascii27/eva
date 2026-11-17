// Pure policy for when an over-the-air update may be applied — no React, no
// expo-updates. useOtaUpdates owns the timers and the reload itself.
//
// A reload restarts all JavaScript, so the rule is really a list of everything
// that lives only in memory and would be lost without a word. Each blocker
// below names one of them.

/**
 * How long the face must have been settled before a reload.
 *
 * The face reaches idle only once a conversation's follow-up window has
 * closed, but people think of one more thing — and the realtime socket is kept
 * for 45s after idle precisely for that re-wake. Two minutes clears both, and
 * costs nothing against an hourly check.
 */
export const QUIET_BEFORE_RELOAD_MS = 120_000;

/** How often to ask the update server. Eva runs for days; an hour is plenty. */
export const CHECK_INTERVAL_MS = 60 * 60_000;

/** How often a pending update re-tries the gate. */
export const RETRY_INTERVAL_MS = 30_000;

export interface ReloadInputs {
  /** True when the face is idle and no round has been claimed. */
  idle: boolean;
  /** When `idle` last became true, epoch ms; null while busy. */
  idleSince: number | null;
  now: number;
  /** Proactive items waiting to be said out loud. */
  backlog: number;
  /** hermes errands queued or running, both kinds. */
  errandsInFlight: number;
  /** Someone has the dev overlay open — they are at the desk. */
  overlayOpen: boolean;
}

export type ReloadBlocker = 'busy' | 'settling' | 'backlog' | 'errands' | 'overlay';

/**
 * Why a reload must wait, or null when it is safe now.
 *
 * Errands come first because they are the one loss nobody would notice: an
 * `ask_other_half` answer arrives minutes later and exists only in memory, so
 * a reload in between drops it silently, and an action would be reported as
 * lost at the next bring-up despite having landed.
 */
export function reloadBlocker(i: ReloadInputs): ReloadBlocker | null {
  if (i.errandsInFlight > 0) return 'errands';
  if (!i.idle || i.idleSince === null) return 'busy';
  if (i.backlog > 0) return 'backlog';
  if (i.overlayOpen) return 'overlay';
  if (i.now - i.idleSince < QUIET_BEFORE_RELOAD_MS) return 'settling';
  return null;
}
