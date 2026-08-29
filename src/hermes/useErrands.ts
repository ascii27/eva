// Running errands. Owned by FaceScreen; the policy is all in errands.ts and
// the delivery belongs to the proactive queue, not to this hook.
//
// Nothing here touches a round. `start` returns an id synchronously and the
// work happens off to the side, which is the whole point: an answer measured at
// 88.7s cannot live inside a spoken turn, so it does not try to.

import { useCallback, useRef, useState } from 'react';
import { chat } from '../agent/openai';
import {
  canAccept,
  deliveryLine,
  errandRequest,
  failureLine,
  nextToRun,
  type Errand,
} from './errands';
import { envHermesConfig, hermesHeaders, SESSION_KEY } from './config';

/**
 * Generous even by the standards of the bundle fetch, because this one is
 * genuinely nobody's critical path — and because a question Eva promised to
 * come back on should fail loudly rather than quietly, which means giving it
 * long enough that a timeout really means something went wrong.
 */
export const ERRAND_TIMEOUT_MS = 300_000;

/** Answers longer than this get cut; hermes was asked for two sentences. */
const MAX_ANSWER_TOKENS = 400;

export interface UseErrandsOptions {
  /** Something to say out loud, once the face is quiet. */
  onResult: (line: string) => void;
  /** Human-readable breadcrumbs for the transcript. */
  onIssue?: (message: string) => void;
}

export function useErrands({ onResult, onIssue }: UseErrandsOptions) {
  const config = useRef(envHermesConfig());
  const errands = useRef<Errand[]>([]);
  // Only so the overlay can show a count; nothing here reads it back.
  const [inFlight, setInFlight] = useState(0);
  const callbacks = useRef({ onResult, onIssue });
  callbacks.current = { onResult, onIssue };
  const seq = useRef(0);

  const publish = useCallback(() => {
    setInFlight(errands.current.filter((e) => e.state === 'queued' || e.state === 'running').length);
  }, []);

  const settle = useCallback(
    (errand: Errand, state: 'done' | 'failed') => {
      errand.state = state;
      // Finished errands are kept, not spliced out: `canAccept` ignores them
      // and the list is a handful of records on a device that reboots weekly.
      // Losing them would also lose the only trace of what she promised.
      publish();
    },
    [publish],
  );

  // Set by pump below. A ref because run() has to kick the queue when it
  // finishes and pump() has to call run() — the cycle has to break somewhere,
  // and a ref breaks it without lying to the dependency linter.
  const pumpRef = useRef<() => void>(() => {});

  const run = useCallback(
    async (errand: Errand): Promise<void> => {
      const cfg = config.current;
      if (!cfg) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ERRAND_TIMEOUT_MS);
      const startedAt = Date.now();
      try {
        const res = await chat({
          apiKey: cfg.apiKey,
          model: cfg.model,
          messages: [{ role: 'user', content: errandRequest(errand.question, errand.needsLookup) }],
          baseUrl: cfg.baseUrl,
          // Its own transcript scope per errand, so unrelated questions minutes
          // apart do not read to hermes as one rambling conversation. The
          // memory scope stays shared — that is the half meant to accumulate.
          headers: { ...hermesHeaders(`${SESSION_KEY}-errand-${errand.id}`) },
          maxTokens: MAX_ANSWER_TOKENS,
          signal: controller.signal,
        });
        const answer = res.text.trim();
        if (!answer) throw new Error('empty answer');
        settle(errand, 'done');
        if (__DEV__) {
          console.log(
            `[hermes] errand ${errand.id} answered in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (lookup ${errand.needsLookup})`,
          );
        }
        callbacks.current.onResult(deliveryLine(errand.question, answer));
      } catch (e) {
        settle(errand, 'failed');
        const why = e instanceof Error ? e.message : String(e);
        callbacks.current.onIssue?.(`hermes · errand failed: ${why}`);
        // Spoken, not swallowed. She said she would come back to him, and
        // silence is the one outcome that makes her untrustworthy rather than
        // merely unlucky.
        callbacks.current.onResult(failureLine(errand.question));
      } finally {
        clearTimeout(timer);
        pumpRef.current();
      }
    },
    [settle],
  );

  /**
   * Start whatever the concurrency cap allows.
   *
   * The errand is marked running HERE, before run() is called, and that is what
   * makes the loop terminate: nextToRun reads the state it just set. Leaving it
   * to run() worked only because the assignment happened to sit above its first
   * await — one await moved and this spins forever.
   */
  const pump = useCallback((): void => {
    for (;;) {
      const next = nextToRun(errands.current);
      if (!next) return;
      next.state = 'running';
      publish();
      void run(next);
    }
  }, [publish, run]);
  pumpRef.current = pump;

  /**
   * Hand a question to hermes and return at once.
   *
   * Synchronous by design — the tool that calls this must not block, or the
   * round it is inside stops being a local round. Returns null when she is
   * already carrying as many as she can, so the tool can have her decline
   * rather than promise something that will not happen.
   */
  const start = useCallback(
    (question: string, needsLookup: boolean): string | null => {
      if (!config.current) return null;
      if (!canAccept(errands.current)) return null;
      const id = `${Date.now().toString(36)}-${seq.current++}`;
      errands.current = [...errands.current, { id, question, needsLookup, startedAt: Date.now(), state: 'queued' }];
      publish();
      pump();
      return id;
    },
    [publish, pump],
  );

  return {
    /** Whether hermes is configured at all — decides if the tool is offered. */
    configured: config.current !== null,
    /** Queued plus running, for the overlay. */
    inFlight,
    start,
  };
}
