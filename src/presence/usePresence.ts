// Owns the presence camera and its clock (ASC-47). The decisions are
// presence.ts's; this turns native face counts and a ticking clock into
// `here` / `busy` / `away`, and calls back when someone sits down.
//
// The camera runs only while presence is enabled (a standing yes, and "stop
// watching" turns it off) and not paused — camera_look's viewfinder needs the
// front camera to itself, so presence steps aside while it is up.

import { useEffect, useRef, useState } from 'react';
import { getCameraPermission, requestCameraPermission } from '../vision/camera';
import {
  isPresenceAvailable,
  onFaces,
  onStatus,
  startPresence,
  stopPresence,
  type PresenceStatus,
} from './native';
import { initialPresence, isAway, step, type PresenceEvent, type PresenceState } from './presence';

/** Time-based transitions (leaving, the room clearing, going away) need a clock. */
const TICK_MS = 5_000;

export interface PresenceView {
  /** The native module is in this build. */
  available: boolean;
  /** The camera is actually running right now — what the badge shows. */
  watching: boolean;
  here: boolean;
  busy: boolean;
  faces: number;
  /** Nobody for AWAY_SLEEP_MS: sleep, whatever the hour. */
  away: boolean;
  status: PresenceStatus | 'off';
}

export function usePresence({
  enabled,
  paused,
  onArrive,
  onIssue,
}: {
  enabled: boolean;
  paused: boolean;
  /** Someone sat down after `awayMs` away; `busy` if more than one face is in view. */
  onArrive: (awayMs: number, busy: boolean) => void;
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
  const issueRef = useRef(onIssue);
  issueRef.current = onIssue;

  useEffect(() => {
    if (!available || !enabled || paused) {
      setStatus('off');
      setView({ here: false, busy: false, faces: 0, away: false });
      return;
    }
    let live = true;

    const publish = () => {
      const s = state.current;
      const next = { here: s.here, busy: s.busy, faces: s.faces, away: isAway(s, Date.now()) };
      setView((v) =>
        v.here === next.here && v.busy === next.busy && v.faces === next.faces && v.away === next.away ? v : next,
      );
    };
    const handle = (events: PresenceEvent[]) => {
      for (const e of events) {
        if (__DEV__) console.log(`[presence] ${e.kind}${e.kind === 'arrived' ? ` after ${Math.round(e.awayMs / 1000)}s` : ''}`);
        if (e.kind === 'arrived') arriveRef.current(e.awayMs, state.current.busy || state.current.faces >= 2);
      }
    };
    const advance = (faces?: number) => {
      const r = step(state.current, Date.now(), faces);
      state.current = r.state;
      handle(r.events);
      publish();
    };

    const facesSub = onFaces((n) => live && advance(n));
    const statusSub = onStatus((s, message) => {
      if (!live) return;
      // Coming back from an interruption, nothing is known about the gap.
      if (s === 'running') state.current = initialPresence(Date.now());
      if (s === 'interrupted' || s === 'error') issueRef.current(`presence · ${s}${message ? ` (${message})` : ''}`);
      setStatus(s);
      publish();
    });
    const tick = setInterval(() => live && advance(), TICK_MS);

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
      const result = await startPresence();
      if (!live) {
        void stopPresence();
        return;
      }
      setStatus(result);
      if (result !== 'running') issueRef.current(`presence · could not start (${result})`);
      publish();
    })();

    return () => {
      live = false;
      clearInterval(tick);
      facesSub?.remove();
      statusSub?.remove();
      void stopPresence();
    };
  }, [available, enabled, paused]);

  return { available, watching: status === 'running', ...view, status };
}
