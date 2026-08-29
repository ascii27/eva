// Running errands. Owned by FaceScreen; the policy is all in errands.ts and
// the delivery belongs to the proactive queue, not to this hook.
//
// Nothing here touches a round. `start` returns an id synchronously and the
// work happens off to the side, which is the whole point: an answer measured at
// 88.7s cannot live inside a spoken turn, so it does not try to.

import { useCallback, useEffect, useRef, useState } from 'react';
import { chat } from '../agent/openai';
import {
  actionFailureLine,
  actionRequest,
  canAccept,
  deliveryLine,
  doneLine,
  errandRequest,
  failureLine,
  nextToRun,
  unfinishedLine,
  type Errand,
  type ErrandKind,
} from './errands';
import { record, settle as settleOutbox, takeUnfinished } from './outbox';
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
          messages: [
            {
              role: 'user',
              content:
                errand.kind === 'action'
                  ? actionRequest(errand.question)
                  : errandRequest(errand.question, errand.needsLookup),
            },
          ],
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
            `[hermes] ${errand.kind} ${errand.id} came back in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (lookup ${errand.needsLookup})`,
          );
        }
        callbacks.current.onResult(
          errand.kind === 'action'
            ? doneLine(errand.question, answer)
            : deliveryLine(errand.question, answer),
        );
      } catch (e) {
        settle(errand, 'failed');
        const why = e instanceof Error ? e.message : String(e);
        callbacks.current.onIssue?.(`hermes · ${errand.kind} failed: ${why}`);
        // Spoken, not swallowed. She said she would come back to him, and
        // silence is the one outcome that makes her untrustworthy rather than
        // merely unlucky.
        //
        // The two lines differ in what they are allowed to claim: a question
        // that failed did not happen, while an action may have landed and
        // completed with only the report lost, so that one says she does not
        // know rather than that it failed.
        callbacks.current.onResult(
          errand.kind === 'action' ? actionFailureLine(errand.question) : failureLine(errand.question),
        );
      } finally {
        // Heard back either way, so there is nothing for a later launch to
        // report. Questions were never written, and settling one is a no-op.
        if (errand.kind === 'action') void settleOutbox(errand.id);
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
   * Hand hermes either kind of errand and return at once.
   *
   * Synchronous by design — the tool that calls this must not block, or the
   * round it is inside stops being a local round. Returns null when she is
   * already carrying as many as she can, so the tool can have her decline
   * rather than promise something that will not happen.
   *
   * `record` is safe to fire and forget here: it writes before its first await,
   * so a dispatch cannot outrun its own journal entry and settle it first.
   */
  const enqueue = useCallback(
    (question: string, kind: ErrandKind, needsLookup: boolean): string | null => {
      if (!config.current) return null;
      if (!canAccept(errands.current)) return null;
      const id = `${Date.now().toString(36)}-${seq.current++}`;
      const sentAt = Date.now();
      errands.current = [...errands.current, { id, question, kind, needsLookup, startedAt: sentAt, state: 'queued' }];
      // Journalled before the pump, so a process that dies between the two
      // still leaves the trace. Questions are not journalled at all.
      if (kind === 'action') void record({ id, action: question, sentAt });
      publish();
      pump();
      return id;
    },
    [publish, pump],
  );

  /** A question: nothing changes, and a lost one costs only asking again. */
  const start = useCallback(
    (question: string, needsLookup: boolean): string | null => enqueue(question, 'question', needsLookup),
    [enqueue],
  );

  /**
   * Hand hermes something to *do* and return at once, exactly as `start` does.
   *
   * Always a lookup: doing the thing is the point, so there is no version of
   * this that should run without tools.
   */
  const send = useCallback((action: string): string | null => enqueue(action, 'action', true), [enqueue]);

  /**
   * Actions the last process never heard back on, said once at bring-up.
   *
   * Runs whether or not hermes is configured now — the records were written by
   * a process that had it, and an unreported change is unreported either way.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = await takeUnfinished();
      if (cancelled) return;
      const line = unfinishedLine(pending.map((p) => p.action));
      if (line) {
        callbacks.current.onIssue?.(`hermes · ${pending.length} action(s) unsettled from a previous run`);
        callbacks.current.onResult(line);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    /** Whether hermes is configured at all — decides if the tools are offered. */
    configured: config.current !== null,
    /** Queued plus running, both kinds, for the overlay. */
    inFlight,
    start,
    send,
  };
}
