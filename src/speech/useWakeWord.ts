import { useCallback, useEffect, useRef, useState } from 'react';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { appendWakeEvent } from './wakeLog';
import { findWake } from './wakeword';

// A continuous on-device recognition session does not live forever: silence
// eventually surfaces as no-speech, Siri/calls interrupt, and the local
// speech XPC connection can drop. The watcher is therefore a restart loop
// keyed on the recognizer's 'end' event — the only point where the previous
// session is guaranteed torn down, so a start() can never race it into
// 'busy'. Sessions are also recycled proactively: on iOS 17- the interim
// transcript accumulates for the whole session, so bounded lifetimes bound
// transcript growth.

const MAX_SESSION_MS = 60_000;
const RECYCLE_RESTART_MS = 250;
const RESUME_SETTLE_MS = 400; // TTS/audio-session teardown before re-arming
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const HEALTHY_SESSION_MS = 10_000; // a session this old resets the backoff
const FAILS_BEFORE_ISSUE = 3;

type WakeState =
  | 'idle' // not listening, no restart scheduled
  | 'starting' // ensureReady/start in flight
  | 'watching' // continuous session live, matching interims
  | 'handoff' // matched; aborting so the command capture can take the mic
  | 'recycling' // proactive max-session restart in progress
  | 'stopping' // suspended/disabled; aborting, will rest at idle
  | 'cooldown'; // restart timer armed

export type WakeStatus = 'off' | 'watching' | 'paused';

export interface WakeWordOptions {
  /** Master switch (persisted by the owner). */
  enabled: boolean;
  /** True while Eva is mid-round or speaking — never watch her own voice. */
  suspended: boolean;
  /** Wake phrase detected; snippet is the matched transcript context. */
  onWake: (snippet: string) => void;
  /** Human-readable persistent failures (permissions, repeated errors…). */
  onIssue?: (message: string) => void;
}

export function useWakeWord({ enabled, suspended, onWake, onIssue }: WakeWordOptions): {
  status: WakeStatus;
} {
  const state = useRef<WakeState>('idle');
  const [status, setStatus] = useState<WakeStatus>('off');
  const snippet = useRef('');
  const sessionStart = useRef(0);
  const consecFails = useRef(0);
  const timers = useRef<{ recycle: ReturnType<typeof setTimeout> | null; restart: ReturnType<typeof setTimeout> | null }>(
    { recycle: null, restart: null },
  );
  // Live copies for the stable native-event callbacks.
  const armed = useRef(false);
  armed.current = enabled && !suspended;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const callbacks = useRef({ onWake, onIssue });
  callbacks.current = { onWake, onIssue };

  const publishStatus = useCallback(() => {
    const s = state.current;
    setStatus(
      !enabledRef.current ? 'off' : s === 'watching' || s === 'starting' || s === 'recycling' ? 'watching' : 'paused',
    );
  }, []);

  const clearTimers = useCallback(() => {
    if (timers.current.recycle) clearTimeout(timers.current.recycle);
    if (timers.current.restart) clearTimeout(timers.current.restart);
    timers.current = { recycle: null, restart: null };
  }, []);

  const start = useCallback(async () => {
    state.current = 'starting';
    publishStatus();
    const blocker = await ensureReady();
    if (state.current !== 'starting') return; // torn down while awaiting
    if (blocker || !armed.current) {
      if (blocker) callbacks.current.onIssue?.(blocker);
      state.current = 'idle';
      publishStatus();
      return;
    }
    startListening('wake');
    sessionStart.current = Date.now();
    state.current = 'watching';
    publishStatus();
    timers.current.recycle = setTimeout(() => {
      if (state.current === 'watching') {
        state.current = 'recycling';
        abortListening();
      }
    }, MAX_SESSION_MS);
  }, [publishStatus]);

  const scheduleStart = useCallback(
    (delayMs: number) => {
      state.current = 'cooldown';
      publishStatus();
      timers.current.restart = setTimeout(() => {
        timers.current.restart = null;
        if (armed.current && (state.current === 'cooldown' || state.current === 'idle')) void start();
      }, delayMs);
    },
    [publishStatus, start],
  );

  useEffect(() => {
    const unsubscribe = addListeners({
      onResult: (r) => {
        if (state.current !== 'watching') return; // not our session, or already handed off
        const match = findWake(r.transcript);
        if (!match) return;
        if (__DEV__) console.log(`[wake] matched · ${match.snippet}`);
        snippet.current = match.snippet;
        state.current = 'handoff';
        if (timers.current.recycle) clearTimeout(timers.current.recycle);
        timers.current.recycle = null;
        void appendWakeEvent(match.snippet);
        abortListening();
      },
      onError: (code) => {
        const s = state.current;
        // Aborts are always ours (handoff, recycle, suspension, echo.cancel)
        // and no-speech is just long silence — neither is a failure; onEnd
        // handles the restart either way.
        if (code === 'aborted' || code === 'no-speech') return;
        if (s !== 'watching' && s !== 'starting') return;
        consecFails.current += 1;
        if (consecFails.current === FAILS_BEFORE_ISSUE) {
          callbacks.current.onIssue?.(`Wake watching keeps failing (${code}) — retrying with backoff.`);
        }
      },
      onEnd: () => {
        const s = state.current;
        if (timers.current.recycle) clearTimeout(timers.current.recycle);
        timers.current.recycle = null;
        if (s === 'handoff') {
          state.current = 'idle';
          publishStatus();
          callbacks.current.onWake(snippet.current); // resumes via the suspended falling edge
          return;
        }
        if (s === 'recycling') {
          if (armed.current) scheduleStart(RECYCLE_RESTART_MS);
          else state.current = 'idle';
          return;
        }
        if (s === 'watching' || s === 'starting') {
          // Error-driven or spontaneous end.
          if (Date.now() - sessionStart.current > HEALTHY_SESSION_MS) consecFails.current = 0;
          if (armed.current) {
            scheduleStart(Math.min(BACKOFF_BASE_MS * 2 ** consecFails.current, BACKOFF_MAX_MS));
          } else {
            state.current = 'idle';
          }
          return;
        }
        if (s === 'stopping') state.current = 'idle';
      },
    });
    return () => {
      unsubscribe();
      clearTimers();
      if (state.current === 'watching' || state.current === 'starting') abortListening();
      state.current = 'idle';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (enabled && !suspended) {
      if (state.current === 'idle') scheduleStart(RESUME_SETTLE_MS);
    } else {
      clearTimers();
      const s = state.current;
      if (s === 'watching' || s === 'starting') {
        state.current = 'stopping';
        abortListening();
      } else if (s === 'cooldown') {
        state.current = 'idle';
      }
    }
    publishStatus();
  }, [enabled, suspended, clearTimers, publishStatus, scheduleStart]);

  return { status };
}
