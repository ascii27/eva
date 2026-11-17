// Over-the-air updates for an app that launches once and runs for days.
//
// expo-updates on its own checks only at launch and applies on the *next*
// launch, so a published update needed two force-quits to reach the desk. This
// hook checks hourly and reloads into a downloaded update at a moment
// reloadBlocker() says loses nothing. The rule is all in reload.ts; timers and
// the reload live here.
//
// In a dev build `Updates.isEnabled` is false and every path here is a no-op.

import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHECK_INTERVAL_MS,
  RETRY_INTERVAL_MS,
  reloadBlocker,
  type ReloadInputs,
} from './reload';

export interface UseOtaUpdatesOptions {
  /** Face idle and no round claimed. Tracked here to time the quiet period. */
  idle: boolean;
  /** Read at the moment of deciding, so refs (the backlog) stay current. */
  gate: () => Pick<ReloadInputs, 'backlog' | 'errandsInFlight' | 'overlayOpen'>;
  onIssue?: (message: string) => void;
}

/** The running bundle, for the overlay. */
function describeRunning(): string {
  if (!Updates.isEnabled) return 'disabled (dev build)';
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'embedded';
  const at = Updates.createdAt;
  const when = at ? `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  return `${Updates.updateId.slice(0, 8)}${when ? ` · ${when}` : ''}`;
}

export function useOtaUpdates({ idle, gate, onIssue }: UseOtaUpdatesOptions) {
  // Also true when the launch-time automatic check downloaded something — that
  // one would otherwise sit unapplied until the next launch, days away.
  const { isUpdatePending } = Updates.useUpdates();
  const [fetched, setFetched] = useState(false);
  const pending = isUpdatePending || fetched;

  const callbacks = useRef({ gate, onIssue });
  callbacks.current = { gate, onIssue };

  const idleSince = useRef<number | null>(idle ? Date.now() : null);
  useEffect(() => {
    idleSince.current = idle ? Date.now() : null;
  }, [idle]);

  // One check or reload at a time: the hourly timer and the overlay button can
  // otherwise race each other into two fetches, or two reloads.
  const busy = useRef(false);

  /** Check and download. True when a new update is now waiting. */
  const fetchIfAny = useCallback(async (): Promise<boolean> => {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const res = await Updates.fetchUpdateAsync();
    if (res.isNew) setFetched(true);
    return res.isNew;
  }, []);

  // The quiet hourly check. Failures are logged, not spoken — a phone that
  // lost Wi-Fi for a minute is not news.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const id = setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      fetchIfAny()
        .then((isNew) => {
          if (isNew) callbacks.current.onIssue?.('update · downloaded, applying when quiet');
        })
        .catch((e) => {
          if (__DEV__) console.log(`[updates] check failed: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          busy.current = false;
        });
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchIfAny]);

  // Once something is waiting, try the gate every so often until it opens.
  // Polled rather than driven by the inputs because the backlog is a ref and
  // the quiet period ends with nothing changing at all.
  useEffect(() => {
    if (!Updates.isEnabled || !pending) return;
    const tryReload = () => {
      if (busy.current) return;
      const blocker = reloadBlocker({
        ...callbacks.current.gate(),
        idle: idleSince.current !== null,
        idleSince: idleSince.current,
        now: Date.now(),
      });
      if (blocker) return;
      busy.current = true;
      console.log('[updates] reloading into downloaded update');
      Updates.reloadAsync().catch((e) => {
        busy.current = false;
        callbacks.current.onIssue?.(`update · reload failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    };
    tryReload();
    const id = setInterval(tryReload, RETRY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pending]);

  /**
   * The overlay button: someone is at the desk and wants the new code now.
   *
   * Reloads straight away — the person pressing it is the safety check for
   * speech — except over an errand, which nobody at the desk can see. Then it
   * downloads and leaves the reload to the gate above.
   */
  const checkNow = useCallback(async (): Promise<void> => {
    const say = (m: string) => callbacks.current.onIssue?.(m);
    if (!Updates.isEnabled) {
      say('update · disabled in this build');
      return;
    }
    if (busy.current) {
      say('update · already checking');
      return;
    }
    busy.current = true;
    try {
      say('update · checking');
      const isNew = (await fetchIfAny()) || isUpdatePending;
      if (!isNew) {
        say('update · already up to date');
        busy.current = false;
        return;
      }
      if (callbacks.current.gate().errandsInFlight > 0) {
        say('update · downloaded; applying once errands land');
        busy.current = false;
        return;
      }
      say('update · reloading');
      await Updates.reloadAsync();
    } catch (e) {
      busy.current = false;
      say(`update · ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [fetchIfAny, isUpdatePending]);

  return {
    /** What is running, for the overlay. */
    label: pending ? `${describeRunning()} · update waiting` : describeRunning(),
    checkNow,
  };
}
