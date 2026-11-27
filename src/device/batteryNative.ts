// Thin I/O around expo-battery (ASC-45). The decisions are battery.ts's.
//
// expo-battery is native, and a JS-only update can reach a build that predates
// it, so it is required lazily — as brightness.ts and stt.ts do — and a build
// without it simply has no battery: the tool is absent from the spec list and
// the watcher never starts.

import { batteryLevel, chargeState, type BatteryReading } from './battery';

type BatteryModule = typeof import('expo-battery');
let native: BatteryModule | null | undefined;
function battery(): BatteryModule | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native = require('expo-battery') as BatteryModule;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Whether this build carries the native module (false before the EAS rebuild). */
export function hasBattery(): boolean {
  return battery() !== null;
}

/** The current reading, or null when the module is missing or the call fails. */
export async function readBattery(): Promise<BatteryReading | null> {
  const b = battery();
  if (!b) return null;
  try {
    const s = await b.getPowerStateAsync();
    return { level: batteryLevel(s.batteryLevel), state: chargeState(s.batteryState), lowPowerMode: s.lowPowerMode };
  } catch {
    return null;
  }
}

/**
 * Call `onChange` whenever level, charging state or low power mode moves.
 * Each event carries only the field that changed, so the listener re-reads the
 * whole state rather than patching a copy. Returns the unsubscribe.
 */
export function watchBattery(onChange: () => void): () => void {
  const b = battery();
  if (!b) return () => {};
  try {
    const subs = [
      b.addBatteryLevelListener(onChange),
      b.addBatteryStateListener(onChange),
      b.addLowPowerModeListener(onChange),
    ];
    return () => subs.forEach((s) => s.remove());
  } catch {
    return () => {};
  }
}
