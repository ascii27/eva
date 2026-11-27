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
//
// Eva and hermes can also set it outright (ASC-46). That level rides into
// every apply as `manual`, and screen.ts's targetLevel decides how it and the
// night schedule share the screen. setScreenBrightness goes through the same
// chain, so a request can't interleave with a phase flip's save.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SleepPhase } from './sleep';
import { clampLevel, targetLevel, type BrightnessChange, type ManualBrightness } from '../device/screen';

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
 * to whoever set it. `manual` is a level someone asked for (screen.ts).
 */
export function applySleepBrightness(phase: SleepPhase, night: boolean, manual: ManualBrightness | null = null): Promise<void> {
  chain = chain.then(() => apply(phase, night, manual)).catch(() => {});
  return chain;
}

async function apply(phase: SleepPhase, night: boolean, manual: ManualBrightness | null): Promise<void> {
  const b = brightness();
  if (!b) return;
  const saved = await AsyncStorage.getItem(DAY_KEY);
  const savedLevel = saved === null ? NaN : Number(saved);
  const now = Date.now();
  if (phase === 'awake' && !night) {
    // By day a requested level simply is the daytime level. It lapses at
    // 06:00 at the latest, so it never stands in front of a morning restore.
    const asked = targetLevel(phase, night, 1, manual, now);
    if (asked !== null) {
      await b.setBrightnessAsync(asked);
      return;
    }
    if (Number.isFinite(savedLevel)) await b.setBrightnessAsync(savedLevel);
    if (saved !== null) await AsyncStorage.removeItem(DAY_KEY);
    return;
  }
  let day = savedLevel;
  if (!Number.isFinite(day)) {
    day = await b.getBrightnessAsync();
    await AsyncStorage.setItem(DAY_KEY, String(day));
  }
  const level = targetLevel(phase, night, day, manual, now);
  if (level !== null) await b.setBrightnessAsync(level);
}

/** The screen's level now (0-1), or null on a build without expo-brightness. */
export async function readScreenBrightness(): Promise<number | null> {
  const b = brightness();
  if (!b) return null;
  try {
    return await b.getBrightnessAsync();
  } catch {
    return null;
  }
}

/**
 * Set the screen to `level` now and say what changed. Chained behind any
 * phase flip in progress. Never rejects: a failure comes back as after: null.
 */
export function setScreenBrightness(level: number, until: number): Promise<BrightnessChange> {
  const run = async (): Promise<BrightnessChange> => {
    const b = brightness();
    if (!b) return { before: null, after: null, until };
    const before = await readScreenBrightness();
    try {
      await b.setBrightnessAsync(clampLevel(level));
    } catch {
      return { before, after: null, until };
    }
    return { before, after: (await readScreenBrightness()) ?? clampLevel(level), until };
  };
  const result = chain.then(run, run);
  chain = result.then(() => {}, () => {});
  return result;
}
