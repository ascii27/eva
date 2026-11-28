// Owns the presence camera and its clock (ASC-47; polled since ASC-55). The
// decisions are presence.ts's; this takes a look every POLL_INTERVAL_MS,
// turns each into `here` / `busy` / `away`, and calls back when someone sits
// down or anything stirs.
//
// The camera is on only for the few seconds of each look — that, not a slower
// detector, is the battery saving: a running capture session costs the same
// whether or not anything reads its frames. It looks only while presence is
// enabled (a standing yes, and "stop watching" turns it off) and not paused —
// camera_look's viewfinder and the light meter need the front camera to
// themselves, so presence steps aside while either is up.

import { useEffect, useRef, useState } from 'react';
import { getCameraPermission, requestCameraPermission } from '../vision/camera';
import { isPresenceAvailable, look, stopPresence, type LookStatus } from './native';
import { initialPresence, isAway, POLL_INTERVAL_MS, step, type PresenceEvent, type PresenceState, type Sample } from './presence';

export type PresenceStatus = 'running' | Exclude<LookStatus, 'ok' | 'stopped' | 'busy'>;

export interface PresenceView {
  /** The native module is in this build. */
  available: boolean;
  /**
   * Presence is looking — the camera may come on at any moment, so this, not
   * the few seconds it is actually on, is what the badge shows.
   */
  watching: boolean;
  here: boolean;
  busy: boolean;
  faces: number;
  /** Nobody and nothing moving for AWAY_SLEEP_MS: sleep, whatever the hour. */
  away: boolean;
  status: PresenceStatus | 'off';
}

export function usePresence({
  enabled,
  paused,
  onArrive,
  onStir,
  onIssue,
}: {
  enabled: boolean;
  paused: boolean;
  /** Someone sat down after `awayMs` away; `busy` if more than one face is in view. */
  onArrive: (awayMs: number, busy: boolean) => void;
  /** A look saw motion or a face: wake the screen. Never a reason to speak. */
  onStir: () => void;
  onIssue: (message: string) => void;
}): PresenceView {
  const available = useRef(isPresenceAvailable()).current;
  const state = useRef<PresenceState>(initialPresence(Date.now()));
  const [status, setStatus] = useState<PresenceStatus | 'off'>('off');
  const [view, setView] = useState({ here: false, busy: false, faces: 0, away: false });

  // Callbacks change identity every render; the effect below must not restart
  // the camera because of that.
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const stirRef = useRef(onStir);
  stirRef.current = onStir;
  const issueRef = useRef(onIssue);
  issueRef.current = onIssue;

  useEffect(() => {
    if (!available || !enabled || paused) {
      setStatus('off');
      setView({ here: false, busy: false, faces: 0, away: false });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The last failure reported, so a camera held elsewhere for an hour is one
    // line in the transcript rather than 240.
    let failing: LookStatus | null = null;

    const publish = () => {
      const s = state.current;
      const next = { here: s.here, busy: s.busy, faces: s.faces, away: isAway(s, Date.now()) };
      setView((v) =>
        v.here === next.here && v.busy === next.busy && v.faces === next.faces && v.away === next.away ? v : next,
      );
    };
    const handle = (events: PresenceEvent[]) => {
      for (const e of events) {
        if (e.kind === 'stirred') {
          stirRef.current();
          continue;
        }
        if (__DEV__) console.log(`[presence] ${e.kind}${e.kind === 'arrived' ? ` after ${Math.round(e.awayMs / 1000)}s` : ''}`);
        if (e.kind === 'arrived') arriveRef.current(e.awayMs, state.current.busy || state.current.faces >= 2);
      }
    };
    const advance = (sample?: Sample) => {
      const r = step(state.current, Date.now(), sample);
      state.current = r.state;
      handle(r.events);
      publish();
    };

    const cycle = async () => {
      if (!live) return;
      const started = Date.now();
      const r = await look();
      if (!live) return;
      if (r.status === 'ok') {
        if (__DEV__) console.log(`[presence] look · ${r.faces} face(s) · motion ${r.motion.toFixed(3)} · ${r.frames} frames`);
        // Coming back from a failure, nothing is known about the gap.
        if (failing) state.current = initialPresence(started);
        failing = null;
        setStatus('running');
        advance({ faces: r.faces, motion: r.motion });
      } else if (r.status !== 'stopped' && r.status !== 'busy') {
        if (failing !== r.status) issueRef.current(`presence · ${r.status}${r.message ? ` (${r.message})` : ''}`);
        failing = r.status;
        setStatus(r.status);
        advance();
        // No permission or no camera won't fix itself on the next look.
        if (r.status === 'denied' || r.status === 'unavailable') return;
      }
      timer = setTimeout(cycle, Math.max(0, POLL_INTERVAL_MS - (Date.now() - started)));
    };

    void (async () => {
      // Asked for here, not on the first look: the standing yes for presence
      // is what this permission is now mostly for.
      const granted = (await getCameraPermission()) || (await requestCameraPermission());
      if (!live) return;
      if (!granted) {
        setStatus('denied');
        issueRef.current('presence · camera permission denied');
        return;
      }
      state.current = initialPresence(Date.now());
      setStatus('running');
      publish();
      void cycle();
    })();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      // Aborts a look in progress, so camera_look gets the camera at once.
      void stopPresence();
    };
  }, [available, enabled, paused]);

  return { available, watching: status === 'running', ...view, status };
}
