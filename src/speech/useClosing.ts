// End-of-conversation memory (ASC-66): what closing.ts has learned, persisted,
// plus the one close that "I wasn't done" can still correct. Policy is all in
// closing.ts; this owns only storage and the clock.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef } from 'react';
import {
  CORRECTION_WINDOW_MS,
  describeClose,
  describeLesson,
  freshMemory,
  learnFromClose,
  learnFromCorrection,
  parseMemory,
  trustsModel,
  type CloseReason,
  type ClosingMemory,
} from './closing';

const KEY = 'eva.closing.v1';

export interface ClosingHandle {
  windowMs(): number;
  demoted(): readonly string[];
  trustsModel(): boolean;
  /** A conversation was closed for `reason`; returns a transcript line. */
  closed(reason: CloseReason): string;
  /**
   * "I wasn't done": learn from the last close if it is still recent, and
   * return a transcript line — or null when there is nothing to correct.
   */
  correct(): string | null;
  /** A new exchange started, so an older close can no longer be corrected. */
  forget(): void;
  /** Back to factory settings (dev overlay). */
  reset(): void;
}

export function useClosing(): ClosingHandle {
  const memory = useRef<ClosingMemory>(freshMemory());
  const last = useRef<{ reason: CloseReason; at: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        memory.current = parseMemory(raw);
      })
      .catch(() => {});
  }, []);

  return useMemo(() => {
    const save = (m: ClosingMemory) => {
      memory.current = m;
      void AsyncStorage.setItem(KEY, JSON.stringify(m)).catch(() => {});
    };
    return {
      windowMs: () => memory.current.windowMs,
      demoted: () => memory.current.demoted,
      trustsModel: () => trustsModel(memory.current),
      closed(reason) {
        // Counted as right straight away; a correction resets the run anyway.
        save(learnFromClose(memory.current, reason));
        last.current = { reason, at: Date.now() };
        return `conversation · closed (${describeClose(reason)})`;
      },
      correct() {
        const l = last.current;
        last.current = null;
        if (!l || Date.now() - l.at > CORRECTION_WINDOW_MS) return null;
        const next = learnFromCorrection(memory.current, l.reason);
        save(next);
        return `conversation · reopened — ${describeLesson(l.reason, next)}`;
      },
      forget() {
        last.current = null;
      },
      reset() {
        last.current = null;
        save(freshMemory());
      },
    } satisfies ClosingHandle;
  }, []);
}
