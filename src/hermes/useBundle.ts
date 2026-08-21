// The bundle's timing and side effects. Owned by FaceScreen, mirroring
// useAgent and useSlack; all the policy it enforces lives in bundle.ts.
//
// The invariant this hook exists to keep: **hermes is never on the critical
// path of a spoken turn.** Nothing here is awaited by `ask`. A refresh in
// flight blocks nothing, a failed refresh changes nothing, and a turn that
// arrives mid-refresh answers from whatever is already resident and says how
// old it is. If you ever find yourself wanting to await a refresh before
// answering, that is the bug, not the fix.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  budgetCore,
  coreTokens,
  parseBundle,
  refreshInterval,
  renderCore,
  renderVolatile,
  staleness,
  type Bundle,
  type Staleness,
} from './bundle';
import { fetchBundle } from './client';
import { envHermesConfig, type HermesConfig } from './config';
import { loadBundle, saveBundle } from './store';

/**
 * How often to reconsider refreshing. Not the cadence — `refreshInterval`
 * decides that, and it moves — just the granularity at which the decision is
 * re-taken. A tick that finds nothing to do costs a comparison.
 *
 * A repeating tick rather than a scheduled timeout because the cadence depends
 * on how long the room has been quiet, which changes while the timer would
 * already be armed. Rescheduling on every mode change would be the same thing
 * with more moving parts.
 */
const TICK_MS = 15_000;

export interface BundleState {
  generatedAt: number;
  coreTokens: number;
  staleness: Staleness;
}

export interface UseBundleOptions {
  /**
   * True while the face is doing anything but idling. Does double duty: a
   * refresh never competes for the network with a turn somebody is listening
   * to, and it is the signal that there is a person in the room, which is what
   * keeps the fast cadence alive.
   */
  busy: boolean;
  /** Human-readable failures and breadcrumbs, for the transcript. */
  onIssue?: (message: string) => void;
}

/** The two system messages, ready for buildRequest. */
export interface BundleText {
  core: string;
  volatile: string;
}

export function useBundle({ busy, onIssue }: UseBundleOptions) {
  const config = useRef<HermesConfig | null>(envHermesConfig());
  const [configured] = useState(config.current !== null);
  // For the overlay and the side column. The rendered text does not live here:
  // `ask` reads it synchronously through `text()`, and going via React state
  // would hand a round whatever was current at its last render.
  const [state, setState] = useState<BundleState | null>(null);

  // The live bundle and its rendered core, together. The core is rendered once
  // at apply time rather than per turn: it is stable by construction, and a
  // spoken round should not be re-rendering two thousand tokens of prose.
  const current = useRef<{ bundle: Bundle; core: string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const lastAttemptAt = useRef(0);
  const lastInteractionAt = useRef(0);
  const callbacks = useRef({ onIssue });
  callbacks.current = { onIssue };

  const publish = useCallback((bundle: Bundle | null) => {
    setState(bundle ? { generatedAt: bundle.generatedAt, coreTokens: coreTokens(bundle), staleness: staleness(bundle.generatedAt, Date.now()) } : null);
  }, []);

  /**
   * Install a bundle, or decline to.
   *
   * The short-circuit on an identical core is the whole point of the
   * core/volatile split: a refresh that changed nothing must not invalidate
   * OpenAI's cached prefix, and comparing the rendered text is the only
   * comparison that answers exactly the question the cache asks.
   */
  const apply = useCallback(
    (bundle: Bundle) => {
      const trimmed = budgetCore(bundle);
      const core = renderCore(trimmed);
      const unchanged = current.current?.core === core;
      current.current = { bundle: trimmed, core };
      publish(trimmed);
      return unchanged;
    },
    [publish],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const cfg = config.current;
    if (!cfg || inFlight.current) return;

    const controller = new AbortController();
    inFlight.current = controller;
    lastAttemptAt.current = Date.now();
    try {
      const res = await fetchBundle(cfg, controller.signal);
      if (controller.signal.aborted) return;
      if (!res.ok) {
        // Deliberately not clearing anything. A stale bundle honestly labelled
        // is worth a great deal more than no bundle at all, and the volatile
        // block is already telling Eva how old this one is getting.
        callbacks.current.onIssue?.(`hermes · bundle refresh failed: ${res.error}`);
        return;
      }

      const bundle = parseBundle(res.raw);
      if (!bundle) {
        callbacks.current.onIssue?.('hermes · bundle did not parse — keeping the last one');
        if (__DEV__) console.log(`[hermes] unparseable bundle: ${res.raw.slice(0, 300)}`);
        return;
      }

      const unchanged = apply(bundle);
      await saveBundle(res.raw);
      if (__DEV__) {
        console.log(
          `[hermes] bundle in ${(res.ms / 1000).toFixed(1)}s · ${coreTokens(bundle)} tokens${unchanged ? ' · unchanged, prefix kept' : ''}`,
        );
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [apply]);

  // Bring-up: the stored bundle first, so a relaunch has a picture within
  // milliseconds, then a live refresh on top of it.
  useEffect(() => {
    if (!config.current) {
      // Silent rather than an issue line: no hermes is a supported state, and
      // saying so every launch would be noise on a device that never had one.
      if (__DEV__) console.log('[hermes] not configured — no bundle');
      return;
    }
    let cancelled = false;
    void (async () => {
      const stored = await loadBundle();
      if (cancelled) return;
      if (stored) {
        apply(stored);
        if (__DEV__) console.log(`[hermes] restored a bundle from disk, ${staleness(stored.generatedAt, Date.now())}`);
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
      inFlight.current?.abort();
    };
  }, [apply, refresh]);

  // Anything but idle means somebody is in the room, which is what keeps the
  // fast cadence alive. Both edges are recorded — a round starting and a round
  // ending are each evidence of a person — which also keeps this out of the
  // render pass, where writing a ref would not belong.
  useEffect(() => {
    lastInteractionAt.current = Date.now();
  }, [busy]);

  useEffect(() => {
    if (!config.current) return;
    const id = setInterval(() => {
      // Staleness first, unconditionally: the displayed age has to keep moving
      // even through a long round, or the overlay reads "fresh" for half an
      // hour after the network dropped.
      const held = current.current?.bundle;
      if (held) publish(held);

      // Never mid-round: the network belongs to the turn somebody is listening
      // to. The next tick picks it up a few seconds later.
      if (busy || inFlight.current) return;
      const now = Date.now();
      if (now - lastAttemptAt.current < refreshInterval(now, lastInteractionAt.current)) return;
      void refresh();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [busy, publish, refresh]);

  /**
   * The bundle as it goes into the prompt, or null when there is none.
   *
   * A function rather than a value, and read at ask time rather than at render
   * time, so a round always gets the bundle that is current *now* — the same
   * reason `useAgent` takes a photo resolver instead of a photo.
   */
  const text = useCallback((now: number): BundleText | null => {
    const held = current.current;
    if (!held) return null;
    return { core: held.core, volatile: renderVolatile(held.bundle, now) };
  }, []);

  return {
    /** Whether a hermes is configured at all. False is a supported state. */
    configured,
    /** Age, cost, and staleness, for the overlay and the side column. */
    state,
    text,
    /** Fetch now, from the dev overlay. */
    refresh: useCallback(() => void refresh(), [refresh]),
  };
}
