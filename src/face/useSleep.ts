// Owns the clock for sleep (ASC-33): tracks when anything last happened,
// re-reads the phase every 15 s, and drives the backlight. The decisions are
// sleep.ts's.
//
// Besides the clock, she can be told: `sleep()` and `wake()` come from the
// go_to_sleep / wake_up tools and from hermes' `[[sleep]]` / `[[wake]]`
// directives. A sleep request never lands mid-round — she would be asleep
// while still saying goodnight, and the round ending would wake her straight
// back up — so it waits, pending, for the face to go quiet.

import { useCallback, useEffect, useRef, useState } from 'react';
import { applySleepBrightness } from './brightness';
import { isSleepyHour } from './geometry';
import { requestedPhase, SleepPhase, SleepRequest, WAKE_HOLD_MS } from './sleep';

const TICK_MS = 15_000;

/** The dev overlay can pin a phase to see it without waiting for 22:00. */
export type SleepOverride = 'auto' | 'dim' | 'asleep';

export function useSleep({ busy, override }: { busy: boolean; override: SleepOverride }) {
  const lastActive = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [request, setRequest] = useState<SleepRequest>(null);
  const [pendingSleep, setPendingSleep] = useState(false);

  // A round starting and a round ending both count as something happening:
  // the quiet clock starts when the conversation is over. Anything happening
  // also ends a requested sleep — that is what "until someone wakes you" means.
  useEffect(() => {
    lastActive.current = Date.now();
    setNow(Date.now());
    if (busy) setRequest((r) => (r?.kind === 'asleep' ? null : r));
  }, [busy]);

  // The requested sleep lands once the face is quiet — after the goodnight.
  useEffect(() => {
    if (!pendingSleep || busy) return;
    setPendingSleep(false);
    setRequest({ kind: 'asleep' });
  }, [pendingSleep, busy]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** A touch anywhere: brighten for the grace period, restart the quiet clock. */
  const poke = useCallback(() => {
    lastActive.current = Date.now();
    setNow(Date.now());
    setRequest((r) => (r?.kind === 'asleep' ? null : r));
  }, []);

  /** Fall asleep as soon as nothing is under way. Safe to call mid-round. */
  const sleep = useCallback(() => {
    setPendingSleep(true);
  }, []);

  /** Wake now and stay bright for WAKE_HOLD_MS, night or not. */
  const wake = useCallback(() => {
    const t = Date.now();
    lastActive.current = t;
    setPendingSleep(false);
    setRequest({ kind: 'awake', until: t + WAKE_HOLD_MS });
    setNow(t);
  }, []);

  const date = new Date(now);
  const night = isSleepyHour(date.getHours());
  const phase: SleepPhase =
    override === 'auto' ? requestedPhase(date, busy, lastActive.current, request) : busy ? 'awake' : override;
  // Told to sleep by day is still asleep, screen and all; the backlight goes
  // back to the daytime level once she is woken and the request is gone.
  const toldAsleep = request?.kind === 'asleep';

  useEffect(() => {
    void applySleepBrightness(phase, night || override !== 'auto' || toldAsleep);
  }, [phase, night, override, toldAsleep]);

  /** For the overlay: what she was told, if anything is still in force. */
  const told =
    pendingSleep ? 'sleep pending' : toldAsleep ? 'told to sleep' : request?.kind === 'awake' && now < request.until ? 'told to stay up' : null;

  return { phase, poke, sleep, wake, told };
}
