// Owns the battery watcher (ASC-45): keeps the latest reading, and hands an
// alert line to `onAlert` when the phone is unplugged or runs low. What counts
// as worth saying is battery.ts's; this file only owns the clock.

import { useCallback, useEffect, useRef } from 'react';
import { alertLine, batteryAlert, UNPLUG_GRACE_MS, type BatteryReading } from './battery';
import { hasBattery, readBattery, watchBattery } from './batteryNative';

export interface UseBatteryOptions {
  /** A line to speak unprompted. FaceScreen queues it like a proactive message. */
  onAlert: (line: string) => void;
  onIssue?: (message: string) => void;
}

export function useBattery({ onAlert, onIssue }: UseBatteryOptions) {
  const latest = useRef<BatteryReading | null>(null);
  const callbacks = useRef({ onAlert, onIssue });
  callbacks.current = { onAlert, onIssue };

  useEffect(() => {
    if (!hasBattery()) return;
    let alive = true;
    let unplugTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const next = await readBattery();
      if (!alive || !next) return;
      const prev = latest.current;
      latest.current = next;
      if (prev && (prev.state !== next.state || prev.lowPowerMode !== next.lowPowerMode)) {
        callbacks.current.onIssue?.(`battery · ${next.state}${next.lowPowerMode ? ' · low power' : ''}`);
      }
      const alert = batteryAlert(prev, next);
      if (!alert) return;
      if (alert.kind === 'low') {
        callbacks.current.onAlert(alertLine(alert));
        return;
      }
      // A nudged cable reads as unplugged for a moment. Only a cable that is
      // still out after the grace gets mentioned, at whatever level it is then.
      if (unplugTimer) clearTimeout(unplugTimer);
      unplugTimer = setTimeout(() => {
        unplugTimer = null;
        const now = latest.current;
        if (alive && now?.state === 'unplugged') callbacks.current.onAlert(alertLine({ kind: 'unplugged', level: now.level }));
      }, UNPLUG_GRACE_MS);
    };

    void refresh();
    const stop = watchBattery(() => void refresh());
    return () => {
      alive = false;
      stop();
      if (unplugTimer) clearTimeout(unplugTimer);
    };
  }, []);

  /**
   * A fresh reading — for the tool and for hermes. Null when there is none.
   * Deliberately does not touch `latest`: that is the watcher's baseline, and
   * a tool call landing between an unplug and its listener event would
   * otherwise swallow the transition the alert is computed from.
   */
  const read = useCallback(async (): Promise<BatteryReading | null> => (await readBattery()) ?? latest.current, []);

  /** The last reading without waiting, for building a request synchronously. */
  const last = useCallback((): BatteryReading | null => latest.current, []);

  return { available: hasBattery(), read, last };
}
