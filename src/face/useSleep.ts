// Owns the clock for sleep (ASC-33): tracks when anything last happened,
// re-reads the phase every 15 s, and drives the backlight. The decisions are
// sleep.ts's.

import { useCallback, useEffect, useRef, useState } from 'react';
import { applySleepBrightness } from './brightness';
import { isSleepyHour } from './geometry';
import { sleepPhase, SleepPhase } from './sleep';

const TICK_MS = 15_000;

/** The dev overlay can pin a phase to see it without waiting for 22:00. */
export type SleepOverride = 'auto' | 'dim' | 'asleep';

export function useSleep({ busy, override }: { busy: boolean; override: SleepOverride }) {
  const lastActive = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  // A round starting and a round ending both count as something happening:
  // the quiet clock starts when the conversation is over.
  useEffect(() => {
    lastActive.current = Date.now();
    setNow(Date.now());
  }, [busy]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** A touch anywhere: brighten for the grace period, restart the quiet clock. */
  const poke = useCallback(() => {
    lastActive.current = Date.now();
    setNow(Date.now());
  }, []);

  const date = new Date(now);
  const night = isSleepyHour(date.getHours());
  const phase: SleepPhase =
    override === 'auto' ? sleepPhase(date, busy, lastActive.current) : busy ? 'awake' : override;

  useEffect(() => {
    void applySleepBrightness(phase, night || override !== 'auto');
  }, [phase, night, override]);

  return { phase, poke };
}
