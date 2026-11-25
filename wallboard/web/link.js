// The board's live link to the server (ASC-38): when to retry, when the stream
// counts as dead, and when to give up and reload. Pure, so it's testable under
// node; app.js owns the EventSource and the timers.
//
// Why the board needs its own retry: EventSource only retries after a network
// drop. A non-200 reply (the proxy's 502 while the server restarts during a
// deploy, a 401) or a wrong content-type closes it for good (readyState CLOSED),
// and the board then sat on old content under the offline badge until someone
// reloaded it (2026-11-25).

export const RETRY_FIRST_MS = 3_000;
export const RETRY_MAX_MS = 60_000;
/** The server sends a `ping` every 25 s, so two missed in a row means a dead stream. */
export const STALE_MS = 60_000;
/** Offline this long and the page reloads, as a last resort. */
export const RELOAD_AFTER_MS = 10 * 60_000;

/** Delay before retry number `attempt` (0-based): 3 s, 6 s, 12 s … capped at 60 s. */
export function retryDelay(attempt) {
  return Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, attempt), RETRY_MAX_MS);
}

/**
 * True when an open stream has gone quiet for too long: the browser may think it
 * is still connected (a half-open socket) or still be retrying on its own.
 */
export function isStale(now, lastMessageAt) {
  return now - lastMessageAt > STALE_MS;
}

/**
 * Reload as a last resort: offline for RELOAD_AFTER_MS, and nobody is using the
 * board (no active view, sheet or toast). `offlineSince` is null while connected.
 */
export function shouldReload({ now, offlineSince, busy }) {
  return offlineSince != null && !busy && now - offlineSince >= RELOAD_AFTER_MS;
}
