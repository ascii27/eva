// The screen's backlight for sleep (ASC-33). Thin I/O around expo-brightness;
// the levels themselves are policy in sleep.ts.
//
// expo-brightness is native, and a JS-only update can reach a dev build that
// predates it, so it is required lazily — as stt.ts does — and every call
// degrades to doing nothing: she still falls asleep, the screen just doesn't
// dim until the next EAS build.
//
// iOS keeps an app-set brightness system-wide, so whatever the phone was at
// before night is saved (in AsyncStorage, so an OTA reload at 3am can't lose
// it) and put back at 06:00. Calls are chained so a phase flip can't race the
// save it depends on.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { nightBrightness, SleepPhase } from './sleep';

const DAY_KEY = 'eva.dayBrightness.v1';

type BrightnessModule = typeof import('expo-brightness');
let native: BrightnessModule | null | undefined;
function brightness(): BrightnessModule | null {
  if (native === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native = require('expo-brightness') as BrightnessModule;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Whether this build can dim the screen at all (false before the EAS rebuild). */
export function canDim(): boolean {
  return brightness() !== null;
}

let chain: Promise<void> = Promise.resolve();

/**
 * Set the backlight for `phase`. `night` false with phase 'awake' is the day:
 * the saved level goes back and is forgotten, and the phone is otherwise left
 * to whoever set it.
 */
export function applySleepBrightness(phase: SleepPhase, night: boolean): Promise<void> {
  chain = chain.then(() => apply(phase, night)).catch(() => {});
  return chain;
}

async function apply(phase: SleepPhase, night: boolean): Promise<void> {
  const b = brightness();
  if (!b) return;
  const saved = await AsyncStorage.getItem(DAY_KEY);
  const savedLevel = saved === null ? NaN : Number(saved);
  if (phase === 'awake' && !night) {
    if (Number.isFinite(savedLevel)) await b.setBrightnessAsync(savedLevel);
    if (saved !== null) await AsyncStorage.removeItem(DAY_KEY);
    return;
  }
  let day = savedLevel;
  if (!Number.isFinite(day)) {
    day = await b.getBrightnessAsync();
    await AsyncStorage.setItem(DAY_KEY, String(day));
  }
  await b.setBrightnessAsync(nightBrightness(phase, day));
}
