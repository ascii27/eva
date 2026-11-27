// Thin I/O around the EvaPresence native module (modules/eva-presence).
//
// Like stt.ts and brightness.ts, it is required lazily: a dev build or OTA
// target that predates the module simply has no presence, and the face runs
// as it always did. Nothing here throws.

export type PresenceStatus = 'running' | 'stopped' | 'interrupted' | 'denied' | 'unavailable' | 'error';

interface Subscription {
  remove(): void;
}

interface PresenceModule {
  start(intervalMs: number): Promise<string>;
  stop(): Promise<void>;
  isRunning(): boolean;
  addListener(event: 'onFaces', fn: (e: { faces: number }) => void): Subscription;
  addListener(event: 'onStatus', fn: (e: { status: PresenceStatus; message?: string | null }) => void): Subscription;
}

let mod: PresenceModule | null | undefined;
function native(): PresenceModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      mod = (requireOptionalNativeModule('EvaPresence') as PresenceModule | null) ?? null;
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

/** How often the detector looks, at most. One a second is plenty for a desk. */
export const DETECT_INTERVAL_MS = 1000;

export async function startPresence(): Promise<PresenceStatus> {
  const m = native();
  if (!m) return 'unavailable';
  try {
    return (await m.start(DETECT_INTERVAL_MS)) as PresenceStatus;
  } catch {
    return 'error';
  }
}

export async function stopPresence(): Promise<void> {
  try {
    await native()?.stop();
  } catch {
    // Stopping a session that already died is not worth a word.
  }
}

export function onFaces(fn: (faces: number) => void): Subscription | null {
  return native()?.addListener('onFaces', (e) => fn(e.faces)) ?? null;
}

export function onStatus(fn: (status: PresenceStatus, message: string | null) => void): Subscription | null {
  return native()?.addListener('onStatus', (e) => fn(e.status, e.message ?? null)) ?? null;
}
