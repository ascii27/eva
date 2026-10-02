// The hermes brain: the same round contract, answered by Eva's other half
// directly instead of by a model the device drives.
//
// Owned by FaceScreen, mirroring useAgent and useRealtime, and like them it
// resolves ask(text) to exactly one AskResult so useEcho cannot tell which
// brain answered. The transport is openai.ts pointed at hermes' OpenAI-
// compatible API server — the same `chat` client useErrands and client.ts
// already use, but streaming.
//
// What makes this brain different is how little of the device it uses, and all
// three absences were measured rather than chosen (scripts/probe-hermes-brain.ts):
//
//   - **No tools.** The API server is an agent runtime, not an LLM proxy: it
//     builds its own AIAgent per request and runs its own toolset server-side.
//     Client specs are accepted without error and silently ignored — and cost
//     20,652 input tokens to be ignored. So camera_look and its spoken-consent
//     gate are absent here, as are the errand tools, which would have Eva
//     sending herself an errand.
//   - **No history.** X-Hermes-Session-Id holds the transcript server-side; a
//     second turn recalled the first with an empty messages array. So
//     history.ts, its compaction and its cached-prefix layout are all unused,
//     and the server's copy is the only copy.
//   - **No persona.** hermes has its own, around 20k tokens of it. persona.ts
//     is the chat brain's prompt and does not apply.
//
// The one thing it needs that the chat brain does not: hermes streams no
// preamble before running a tool. A lookup turn was 8.8s of silence and a
// memory turn 16.3s. `hermes.tool.progress` events are the only warning, and
// forwarding them to onToolStart is what arms the aside machinery that covers
// the gap.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskOptions, AskResult } from '../round/ask';
import { speakableFromMrkdwn } from '../round/speakable';
import { SESSION_GAP_MS } from '../agent/history';
import { chatStream, type ChatUsage, formatUsage } from '../agent/openai';
import { addSpend, emptySpend, formatSpend, type Spend } from '../agent/spend';
import { brainSessionId, envHermesConfig, type HermesConfig, hermesHeaders } from './config';
import { DESK_PREAMBLE } from './prompt';
import { startedTools } from './progress';

/**
 * How long the stream may go *quiet* before the round is called dead.
 *
 * Deliberately an idle timeout rather than the chat brain's flat 30s budget. A
 * hermes turn is a full agent run and its length is genuinely unbounded —
 * measured at 2.1s conversationally but 16.3s for a memory question — so a
 * fixed deadline either kills good rounds or waits far too long on dead ones.
 * Progress frames make liveness observable: a stream that is working says so.
 */
const IDLE_TIMEOUT_MS = 45_000;

/**
 * Cap on the spoken reply. hermes honours no brevity control (there is no
 * `verbosity` and no documented max_tokens), and its answers ran long on
 * lookups — 325 chars on the memory question against the 61 of a plain hello.
 * This is the only lever the device has, and it is a backstop against a
 * paragraph being read aloud rather than a target.
 */
const MAX_REPLY_TOKENS = 300;

export type HermesBrainStatus = 'unconfigured' | 'ready';

/**
 * Structurally a subset of UseAgentOptions, so FaceScreen can hand all three
 * brains the same object and they cannot drift. The vision, errand, photo and
 * bundle handles are accepted and unused: this brain has no client tools to
 * reach them with, and hermes *is* where a bundle comes from.
 */
export interface UseHermesOptions {
  onIssue?: (line: string) => void;
  onUsage?: (line: string) => void;
}

export function useHermes({ onIssue, onUsage }: UseHermesOptions = {}) {
  const [status, setStatus] = useState<HermesBrainStatus>('unconfigured');
  const [model, setModel] = useState<string | null>(null);
  const config = useRef<HermesConfig | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const askGen = useRef(0);
  const spend = useRef<Spend>(emptySpend(Date.now()));
  /** Start of the live server-side transcript, and the clock the gap reads. */
  const sessionAt = useRef<number>(Date.now());
  const lastAt = useRef<number>(0);

  // Callbacks via ref so a re-render of FaceScreen never re-creates `ask` and
  // strands an in-flight round — same reason useAgent does it.
  const callbacks = useRef({ onIssue, onUsage });
  callbacks.current = { onIssue, onUsage };

  useEffect(() => {
    const cfg = envHermesConfig();
    config.current = cfg;
    setStatus(cfg ? 'ready' : 'unconfigured');
    setModel(cfg?.model ?? null);
    if (__DEV__) {
      console.log(cfg ? `[hermes-brain] ready · ${cfg.baseUrl} · ${cfg.model}` : '[hermes-brain] not configured');
    }
  }, []);

  /**
   * Roll onto a fresh server-side transcript when the conversation has lapsed.
   *
   * The same thirty-minute gap the local brain archives on, for the same
   * reason: a question asked hours later is not a follow-up. Here it costs
   * nothing to archive — hermes keeps its own memory — so rotating the id is
   * the whole of it.
   */
  const scope = (now: number): string => {
    if (lastAt.current && now - lastAt.current > SESSION_GAP_MS) {
      sessionAt.current = now;
      if (__DEV__) console.log('[hermes-brain] gap — new transcript');
    }
    lastAt.current = now;
    return brainSessionId(sessionAt.current);
  };

  const ask = useCallback(async (text: string, opts?: AskOptions): Promise<AskResult> => {
    const cfg = config.current;
    if (!cfg) return { kind: 'offline', message: "I can't reach my other half right now." };

    const gen = ++askGen.current;
    // A new round supersedes the old one: stop the previous request streaming
    // and stop its deltas reaching the face.
    inFlight.current?.abort();

    const postedAt = Date.now();
    const sessionId = scope(postedAt);
    const controller = new AbortController();
    inFlight.current = controller;

    let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    /** Any sign of life re-arms the clock; a working stream must not time out. */
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };

    let usage: ChatUsage | null = null;
    // What the speaker has already been handed. On a mid-stream failure this is
    // what Eva actually said out loud, which decides whether the round
    // apologises or simply stops.
    let streamed = '';
    /** Tools already reported, so a second progress frame is not a second gap. */
    const announced = new Set<string>();

    try {
      if (__DEV__) console.log(`[hermes-brain] ask "${text}" · transcript ${sessionId}`);
      const res = await chatStream({
        apiKey: cfg.apiKey,
        model: cfg.model,
        // Two messages: which door this is, and what he said. The transcript
        // itself lives on the server, keyed by the header. See DESK_PREAMBLE
        // for why it rides every turn rather than seeding the session once.
        messages: [
          { role: 'system', content: DESK_PREAMBLE },
          { role: 'user', content: text },
        ],
        baseUrl: cfg.baseUrl,
        headers: hermesHeaders(sessionId),
        signal: controller.signal,
        maxTokens: MAX_REPLY_TOKENS,
        onDelta: (delta) => {
          alive();
          streamed += delta;
          opts?.onDelta?.(delta);
        },
        onEvent: (events) => {
          alive();
          const started = startedTools(events).filter((t) => !announced.has(t));
          if (!started.length) return;
          for (const t of started) announced.add(t);
          // No preamble was streamed — hermes does not emit one — so this is
          // what arms the asides that cover the gap. See useEcho's onToolStart.
          opts?.onToolStart?.(started);
        },
      });

      const replyAt = Date.now();
      usage = res.usage;
      spend.current = addSpend(spend.current, usage, true);
      if (usage) {
        // The cache rate is the interesting number here and it is reliably
        // zero: the ~20k prefix hermes bills is its own, not ours, so none of
        // history.ts's cached-prefix work applies. Printed so a change shows.
        const hit = usage.promptTokens ? Math.round((usage.cachedTokens / usage.promptTokens) * 100) : 0;
        console.log(`[spend] hermes round · ${formatUsage(usage)} · ${hit}% cached`);
        console.log(`[spend] hermes total · ${formatSpend(spend.current, replyAt)}`);
        callbacks.current.onUsage?.(`hermes · ${formatUsage(usage)} · ${hit}% cached`);
      }

      const raw = res.text.trim();
      if (!raw) return { kind: 'error', message: 'hermes · empty reply' };
      // Nothing durable to write — the transcript is the server's — but a
      // superseded round must still not speak over the live one.
      if (gen !== askGen.current) return { kind: 'error', message: 'hermes · superseded' };

      return { kind: 'reply', raw, speakable: speakableFromMrkdwn(raw), postedAt, replyAt };
    } catch (e) {
      if (gen !== askGen.current) return { kind: 'error', message: 'hermes · superseded' };
      // Part of the answer is already audible; let it stand rather than
      // apologising over the top of it.
      if (streamed) return { kind: 'error', message: 'hermes · stream failed mid-reply' };
      if (controller.signal.aborted) return { kind: 'timeout', postedAt };
      return { kind: 'error', message: `hermes · ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  /** Start a fresh server-side transcript from the next turn. */
  const endSession = useCallback(async (): Promise<void> => {
    sessionAt.current = Date.now();
    lastAt.current = 0;
    if (__DEV__) console.log('[hermes-brain] new transcript');
    callbacks.current.onIssue?.('hermes · new transcript');
  }, []);

  /**
   * There is no forgetting from here. hermes' long-term memory is server-side,
   * under a session key that deliberately spans every session, and no
   * memory-write API is exposed (`/v1/capabilities` reports
   * `memory_write_api: false`). Rotating the transcript is all the device can
   * do, and saying so beats a button that quietly does nothing.
   */
  const forgetAll = useCallback(async (): Promise<void> => {
    await endSession();
    callbacks.current.onIssue?.("hermes · can't forget from the desk — memory is his");
  }, [endSession]);

  /**
   * Not switchable from here. The API server ignores a bare `model` unless
   * `direct_model_requests` is enabled server-side, and routing is decided by
   * its own precedence (session override → model_routes alias → request →
   * gateway default). EXPO_PUBLIC_HERMES_MODEL is the device's only say.
   */
  const cycleModel = useCallback(async (): Promise<void> => {
    callbacks.current.onIssue?.('hermes · model is his to choose');
  }, []);

  return { status, model, ask, endSession, forgetAll, cycleModel };
}
