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
// three absences were measured rather than chosen (by the since-removed scripts/probe-hermes-brain.ts, 401fe07):
//
//   - **No tools.** The API server is an agent runtime, not an LLM proxy: it
//     builds its own AIAgent per request and runs its own toolset server-side.
//     Client specs are accepted without error and silently ignored — and cost
//     20,652 input tokens to be ignored. So camera_look is absent here — hermes
//     asks for a photo with a `[[look]]` token instead, and the device runs the
//     same spoken-consent gate on its behalf (`lookThenAnswer`, ASC-43) — as
//     are the errand tools, which would have Eva sending herself an errand.
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
import { deskStatusLine, type BatteryReading } from '../device/battery';
import { startedTools } from './progress';
import type { ContentPart } from '../agent/history';
import type { VisionHandles } from '../agent/tools';
import { wantsLook } from '../round/directives';
import { CONSENT_QUESTION } from '../vision/consent';
import {
  CAMERA_FAILED_LINE,
  CAMERA_OFF_LINE,
  DECLINED_LINE,
  DECLINED_NOTE,
  NO_CAMERA_LINE,
  photoContent,
  type PhotoContext,
  withNote,
} from './look';

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
 * brains the same object and they cannot drift. The errand and photo
 * handles are accepted and unused: this brain has no client tools to reach
 * them with. The vision handles are
 * used, by `[[look]]`.
 */
export interface UseHermesOptions {
  onIssue?: (line: string) => void;
  onUsage?: (line: string) => void;
  /**
   * Camera handles, for `[[look]]` (ASC-43). hermes cannot call camera_look —
   * client tools are ignored here — so it asks in text instead and the device
   * runs the gate and the shutter on its behalf.
   */
  vision?: VisionHandles | null;
  /**
   * The last battery reading, or null. hermes cannot call device_battery, so
   * the reading rides along as its own system line on every turn (ASC-45).
   */
  batteryReading?: () => BatteryReading | null;
  /**
   * The screen's level and the last room-light reading, as one system line
   * (ASC-46), or null. Same reason as the battery: hermes has no device tools.
   * Async because the brightness read is; it never measures light, which would
   * flash the camera on every turn.
   */
  screenStatus?: () => Promise<string | null>;
  /**
   * The face rules and the current personality, as one system line (ASC-59).
   * Per turn rather than in DESK_PREAMBLE: the personality changes, and
   * DESK_PREAMBLE stays fixed text with no imports so the probes can load it.
   */
  personalityLine?: () => string | null;
}

export function useHermes({
  onIssue,
  onUsage,
  vision = null,
  batteryReading,
  screenStatus,
  personalityLine,
}: UseHermesOptions = {}) {
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
  const callbacks = useRef({ onIssue, onUsage, batteryReading, screenStatus, personalityLine });
  callbacks.current = { onIssue, onUsage, batteryReading, screenStatus, personalityLine };
  const visionRef = useRef(vision);
  visionRef.current = vision;
  /** Something hermes should hear at the top of its next turn — a refused photo. */
  const pendingNote = useRef<string | null>(null);

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
      // A note belongs to the transcript it was about.
      pendingNote.current = null;
      if (__DEV__) console.log('[hermes-brain] gap — new transcript');
    }
    lastAt.current = now;
    return brainSessionId(sessionAt.current);
  };

  /**
   * One streamed hermes turn on the current transcript, mapped to an AskResult.
   *
   * Shared by an ordinary question and by the photo turn that follows a
   * `[[look]]`. Each turn arms its own idle clock and disarms it on the way
   * out, so nothing is ticking while the consent gate between them waits on a
   * human — the same reason useAgent's `gated()` suspends its ask clock.
   */
  const streamTurn = useCallback(
    async (
      gen: number,
      cfg: HermesConfig,
      sessionId: string,
      content: string | ContentPart[],
      opts: AskOptions | undefined,
      postedAt: number,
    ): Promise<AskResult> => {
      // A new round supersedes the old one: stop the previous request streaming
      // and stop its deltas reaching the face.
      inFlight.current?.abort();
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

      // The battery, read fresh each turn — hermes has no device_battery (ASC-45).
      const battery = callbacks.current.batteryReading?.() ?? null;
      const screen = (await callbacks.current.screenStatus?.().catch(() => null)) ?? null;
      const manner = callbacks.current.personalityLine?.() ?? null;

      try {
        const res = await chatStream({
          apiKey: cfg.apiKey,
          model: cfg.model,
          // Two messages: which door this is, and what he said (or the photo).
          // The transcript itself lives on the server, keyed by the header. See
          // DESK_PREAMBLE for why it rides every turn rather than seeding the
          // session once.
          messages: [
            { role: 'system', content: DESK_PREAMBLE },
            ...(battery ? [{ role: 'system' as const, content: deskStatusLine(battery) }] : []),
            ...(screen ? [{ role: 'system' as const, content: screen }] : []),
            ...(manner ? [{ role: 'system' as const, content: manner }] : []),
            { role: 'user', content },
          ],
          baseUrl: cfg.baseUrl,
          headers: hermesHeaders(sessionId),
          signal: controller.signal,
          maxTokens: MAX_REPLY_TOKENS,
          onDelta: (delta) => {
            alive();
            if (gen !== askGen.current) return;
            streamed += delta;
            opts?.onDelta?.(delta);
          },
          onEvent: (events) => {
            alive();
            if (gen !== askGen.current) return;
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
    },
    [],
  );

  /**
   * hermes has asked to see, and the question is already out loud (or about to
   * be — the gate speaks CONSENT_QUESTION when nothing was). Run the spoken
   * gate, take the photo on a yes, and send it back as the next turn, whose
   * answer is this round's answer (ASC-43).
   *
   * Mirrors `runCameraLook` step for step, because it makes the same promise:
   * iOS permission before the mic opens, viewfinder (and the face's camera
   * badge) up while the question plays, shutter only after an audible yes.
   * Every way the photo can fail to happen is said locally and at once — it is
   * only the device that knows, and a hermes turn to phrase "okay" would be a
   * full agent run.
   */
  const lookThenAnswer = useCallback(
    async (
      gen: number,
      cfg: HermesConfig,
      sessionId: string,
      context: PhotoContext,
      opts: AskOptions | undefined,
      postedAt: number,
    ): Promise<AskResult> => {
      /** A line of Eva's own, streamed so it lands on whichever stream is open. */
      const say = (line: string): AskResult => {
        opts?.onDelta?.(` ${line}`);
        const at = Date.now();
        return { kind: 'reply', raw: line, speakable: line, postedAt, replyAt: at };
      };
      const superseded: AskResult = { kind: 'error', message: 'hermes · superseded' };

      // A message that was only the token opened a stream with nothing audible
      // on it, and the gate trusts an open stream to have asked already — so
      // ask here, or the mic would open on a question nobody heard.
      if (!speakableFromMrkdwn(context.asked ?? '')) opts?.onDelta?.(CONSENT_QUESTION);

      const vision = visionRef.current;
      // No gate means no way to ask, and unasked is not allowed.
      if (!vision || !opts?.onConsent) {
        callbacks.current.onIssue?.('hermes · asked to look, but this round has no camera gate');
        return say(NO_CAMERA_LINE);
      }
      if (!(await vision.ensurePermission())) {
        callbacks.current.onIssue?.('hermes · asked to look, but camera access is off');
        return say(CAMERA_OFF_LINE);
      }
      if (gen !== askGen.current) return superseded;

      vision.showPreview();
      let dataUrl: string;
      try {
        const allowed = await opts.onConsent();
        if (gen !== askGen.current) return superseded;
        if (!allowed) {
          // Told on the next turn rather than now: hermes' transcript should not
          // end on a question nobody answered, but a turn of its own to carry
          // one fact is a full agent run.
          pendingNote.current = DECLINED_NOTE;
          return say(DECLINED_LINE);
        }
        const shot = await vision.takePhoto();
        if ('error' in shot) {
          callbacks.current.onIssue?.(`hermes · look: ${shot.error}`);
          return say(CAMERA_FAILED_LINE);
        }
        dataUrl = shot.photo.dataUrl;
      } catch (e) {
        // A handle that rejects mid-round must not take the round down with it.
        callbacks.current.onIssue?.(`hermes · look: ${e instanceof Error ? e.message : String(e)}`);
        return say(CAMERA_FAILED_LINE);
      } finally {
        vision.hidePreview();
      }
      if (gen !== askGen.current) return superseded;

      if (__DEV__) console.log(`[hermes-brain] photo → transcript ${sessionId}`);
      // A second [[look]] in this answer is stripped from speech and ignored:
      // one photo per yes, never a loop of them.
      return streamTurn(gen, cfg, sessionId, photoContent(context, dataUrl), opts, Date.now());
    },
    [streamTurn],
  );

  const ask = useCallback(
    async (text: string, opts?: AskOptions): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I can't reach my other half right now." };

      const gen = ++askGen.current;
      const postedAt = Date.now();
      const sessionId = scope(postedAt);
      const note = pendingNote.current;
      pendingNote.current = null;
      if (__DEV__) console.log(`[hermes-brain] ask "${text}" · transcript ${sessionId}`);

      const result = await streamTurn(gen, cfg, sessionId, withNote(text, note), opts, postedAt);
      if (result.kind !== 'reply' || !wantsLook(result.raw)) return result;
      // The reply was the consent question, and it is already playing.
      return lookThenAnswer(gen, cfg, sessionId, { words: text, asked: result.raw }, opts, postedAt);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamTurn, lookThenAnswer],
  );

  /**
   * hermes asked to see from somewhere that is not a spoken turn — a `[[look]]`
   * in a Slack message, either pushed on its own or answering the Slack brain.
   * `asked` is that message: spoken first as the round's opening, so the gate
   * finds the question already asked, and quoted back with the photo because
   * the hermes answering here (the API server) is not the one that asked.
   */
  const see = useCallback(
    async (asked: string, opts?: AskOptions, words?: string | null): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I can't reach my other half right now." };

      const gen = ++askGen.current;
      inFlight.current?.abort();
      const postedAt = Date.now();
      const sessionId = scope(postedAt);
      const question = speakableFromMrkdwn(asked);
      if (question) opts?.onDelta?.(question);
      return lookThenAnswer(gen, cfg, sessionId, { words, asked }, opts, postedAt);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookThenAnswer],
  );

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

  return { status, model, ask, see, endSession, forgetAll, cycleModel };
}
