// Thin I/O around the EvaPresence native module (modules/eva-presence).
//
// Like stt.ts and brightness.ts, it is required lazily: a dev build or OTA
// target that predates the module simply has no presence, and the face runs
// as it always did. Nothing here throws.
//
// One call, `look()` (ASC-55): native turns the front camera on, lets
// exposure settle, watches for a couple of seconds, turns the camera off, and
// resolves with a held face count and a motion score. There is no stream and
// no event; usePresence calls it every POLL_INTERVAL_MS.

export type LookStatus = 'ok' | 'stopped' | 'busy' | 'interrupted' | 'denied' | 'unavailable' | 'error';

export interface Look {
  status: LookStatus;
  faces: number;
  /** Share of the frame that changed during the look, 0-1. */
  motion: number;
  /** Frames actually examined, for the dev log. */
  frames: number;
  message: string | null;
}

interface PresenceModule {
  look(settleMs: number, windowMs: number): Promise<{
    status: string;
    faces?: number;
    motion?: number;
    frames?: number;
    message?: string | null;
  }>;
  stop(): Promise<void>;
}

let mod: PresenceModule | null | undefined;
function native(): PresenceModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      const m = requireOptionalNativeModule('EvaPresence') as PresenceModule | null;
      // A build from before ASC-55 streams instead and has no `look`: no presence until the rebuild.
      mod = m && typeof m.look === 'function' ? m : null;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** Whether this build carries the module at all (false before the EAS rebuild). */
export function isPresenceAvailable(): boolean {
  return native() !== null;
}

/** Exposure needs this long after the camera starts, or its drift reads as motion. */
export const SETTLE_MS = 1000;
/** How long each look watches once settled. Camera-on time is about the sum, every 15s. */
export const WINDOW_MS = 2000;

const failed = (status: LookStatus, message: string | null = null): Look => ({ status, faces: 0, motion: 0, frames: 0, message });

/** Take one look. Resolves 'stopped' if stopPresence() lands while it runs. */
export async function look(): Promise<Look> {
  const m = native();
  if (!m) return failed('unavailable');
  try {
    const r = await m.look(SETTLE_MS, WINDOW_MS);
    return {
      status: r.status as LookStatus,
      faces: r.faces ?? 0,
      motion: r.motion ?? 0,
      frames: r.frames ?? 0,
      message: r.message ?? null,
    };
  } catch (e) {
    return failed('error', e instanceof Error ? e.message : null);
  }
}

/** Abort a look in progress and make sure the camera is off. */
export async function stopPresence(): Promise<void> {
  try {
    await native()?.stop();
  } catch {
    // Stopping a session that already died is not worth a word.
  }
}
