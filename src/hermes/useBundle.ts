// The bundle's side effects. Owned by FaceScreen, mirroring useAgent and
// useSlack; all the policy it enforces lives in bundle.ts.
//
// **THERE IS NO PREFETCH.** An earlier design polled hermes for a bundle every
// 150 seconds. The first live measurement killed it: one bundle cost 325,546
// prompt tokens on hermes' side and took 88.7 seconds, because it is a full
// agent run with tools behind it. On that cadence it is roughly 190M tokens a
// day, most of them produced at three in the morning for nobody.
//
// So the bundle is now something hermes will *broadcast* when it has something
// to say, and this hook is the receiving half waiting for that to exist. What
// remains live today is everything below the arrival: parse, budget, render,
// age, persist, and hand two strings to the prompt. `refresh()` is still here
// and still works, but it is wired only to the dev overlay's button — a person
// pressing it, not a timer.
//
// The invariant that outlives all of it: **hermes is never on the critical path
// of a spoken turn.** Nothing here is awaited by `ask`. A refresh in flight
// blocks nothing and a failed one changes nothing. Anything Eva actually needs
// from hermes mid-conversation goes through `ask_other_half` and comes back
// minutes later — see src/hermes/errands.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  budgetCore,
  coreTokens,
  parseBundle,
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
 * How often the *displayed* age is recomputed. Nothing is fetched on this tick —
 * without it the overlay would read "fresh" for half an hour after the last
 * bundle arrived.
 */
const TICK_MS = 15_000;

export interface BundleState {
  generatedAt: number;
  coreTokens: number;
  staleness: Staleness;
}

export interface UseBundleOptions {
  /** Human-readable failures and breadcrumbs, for the transcript. */
  onIssue?: (message: string) => void;
}

/** The two system messages, ready for buildRequest. */
export interface BundleText {
  core: string;
  volatile: string;
}

export function useBundle({ onIssue }: UseBundleOptions = {}) {
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
      if (cancelled || !stored) return;
      // Restored, not fetched. Whatever hermes last sent is what she knows, and
      // the volatile block will say how old that is — which past thirty minutes
      // is Eva telling him plainly that she is out of sync.
      apply(stored);
      if (__DEV__) console.log(`[hermes] restored a bundle from disk, ${staleness(stored.generatedAt, Date.now())}`);
    })();
    return () => {
      cancelled = true;
      inFlight.current?.abort();
    };
  }, [apply, refresh]);

  // Keep the displayed age moving. Nothing is fetched here.
  useEffect(() => {
    const id = setInterval(() => {
      const held = current.current?.bundle;
      if (held) publish(held);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [publish]);

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
    /**
     * Fetch one now. Wired to the dev overlay's button and nothing else — the
     * only way to exercise the render path on the device until hermes
     * broadcasts. Deliberately not on a timer; see the note at the top.
     */
    refresh: useCallback(() => void refresh(), [refresh]),
  };
}
