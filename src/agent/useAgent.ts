// The local agent loop: owns the OpenAI credentials, the live session, and the
// ask round trip. Owned by FaceScreen, mirroring useSlack.
//
// Same contract as the Slack transport — ask(text) resolves to exactly one
// AskResult — so useEcho cannot tell which brain answered. What differs is that
// the answer comes back in about a second instead of up to ninety, and that
// conversation state is ours to keep (see history.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskOptions, AskResult } from '../round/ask';
import { speakableFromMrkdwn } from '../round/speakable';
import {
  type AgentConfig,
  MODEL_PRESETS,
  envAgentInput,
  envTavilyKey,
  getAgentConfig,
  resolveModel,
  setModelOverride,
} from './config';
import { captionFor, type Photo } from '../vision/photos';
import {
  appendTurn,
  applyCompaction,
  buildRequest,
  type BundleText,
  isGap,
  MEMORY_LIMIT,
  newSession,
  planCompaction,
  type PhotoResolver,
  type Session,
} from './history';
import { chat, chatStream, type ChatUsage, formatUsage, type RequestMessage } from './openai';
import { NOTHING_TO_REMEMBER, PERSONA, SUMMARIZE_SESSION, SUMMARIZE_TURNS } from './persona';
import { archiveSession, clearAll, loadSession, recentMemories, saveSession } from './store';
import { buildToolKit, type ToolKit, type VisionHandles } from './tools';

/**
 * A local round should feel immediate; anything this slow has gone wrong rather
 * than gone slowly. Well under the Slack path's 90s, which was sized for a
 * human-speed agent doing real work.
 */
export const ASK_TIMEOUT_MS = 30_000;

/**
 * Guard on the tool loop. Four laps is a preamble, a tool, a second tool if the
 * first one wasn't enough, and an answer — past that she is going in circles on
 * someone's time.
 */
const MAX_STEPS = 4;

/** Keeps replies short enough to be listenable, and caps the cost of a runaway. */
const MAX_REPLY_TOKENS = 300;

/** Summaries are cheap and shouldn't wander. */
const MAX_SUMMARY_TOKENS = 300;

/**
 * The text alongside a photo. Deliberately in Michael's voice: the image is
 * pushed as a user message (an image cannot ride on a tool message), so it
 * should read as him showing her something rather than as narration.
 */
const PHOTO_MESSAGE = 'Here is the photo from the camera.';

/** Running total across a round's laps. Either side may be absent. */
function addUsage(a: ChatUsage | null, b: ChatUsage | null): ChatUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

/** Dev breadcrumb guard: the tool list is fixed for the session, so print it once. */
let toolsLogged = false;

export type AgentStatus = 'unconfigured' | 'ready';

export interface UseAgentOptions {
  /** Human-readable failures and per-round token spend, for the transcript. */
  onIssue?: (message: string) => void;
  /** Per-round token usage line, e.g. `agent · 412 in (256 cached) · 89 out`. */
  onUsage?: (line: string) => void;
  /** Camera handles, or null on a build without one — decides whether
   *  `camera_look` is offered at all. Read once, at bring-up. */
  vision?: VisionHandles | null;
  /** Photo bytes by id, for the request. Null from it means aged out. */
  resolvePhoto?: PhotoResolver;
  /**
   * What hermes knows about Michael's week, or null when there is no bundle.
   *
   * A getter taking `now`, not a value, for two reasons: a round must use the
   * bundle that is current when it is *asked* rather than whichever one the
   * hook last rendered with, and the freshness half has to be rendered against
   * this moment. Same shape and same reasoning as `resolvePhoto`.
   *
   * Nothing here ever waits on hermes. If this returns null — no hermes
   * configured, or none fetched yet — the request is exactly what it was before
   * the bridge existed.
   */
  bundleText?: (now: number) => BundleText | null;
}

export function useAgent({ onIssue, onUsage, vision = null, resolvePhoto, bundleText }: UseAgentOptions = {}) {
  const [status, setStatus] = useState<AgentStatus>('unconfigured');
  const [model, setModel] = useState<string | null>(null);
  const config = useRef<AgentConfig | null>(null);
  // Built once at bring-up, never per turn: the specs are part of OpenAI's
  // cached prefix, so a list that moved between turns would cost the discount.
  const tools = useRef<ToolKit>(buildToolKit({ tavilyKey: envTavilyKey(), vision }));
  if (__DEV__ && !toolsLogged) {
    toolsLogged = true;
    // What Eva is actually offered. Worth printing: "she says she can't do
    // that" looks identical whether the tool is missing or she declined it,
    // and only one of those is a wiring problem.
    console.log(`[agent] tools offered: ${tools.current.specs.map((s) => s.name).join(', ') || 'none'}`);
  }
  // The live session and the memory block. Refs, not state: ask() reads them
  // synchronously and nothing about the face changes when they move.
  const session = useRef<Session | null>(null);
  const memories = useRef<string[]>([]);
  // Non-null while a compaction is in flight, so a second round can't start one.
  const compacting = useRef(false);
  /** Bumped per ask; a resolved round whose generation has moved on must not
   *  touch history — its answer belongs to a question already superseded. */
  const askGen = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /**
   * Rounds answered straight off vs. rounds that had to reach for a tool, since
   * launch. The harness spec calls this the single best health metric for the
   * system, on the reading that a low direct rate means the bundle is too thin
   * rather than the model too weak. Counted on the first lap only — later laps
   * are the same round continuing.
   */
  const recall = useRef({ direct: 0, tool: 0 });
  const callbacks = useRef({ onIssue, onUsage, resolvePhoto, bundleText });
  callbacks.current = { onIssue, onUsage, resolvePhoto, bundleText };

  /** One completion, outside the conversation — used for both summarizers. */
  const complete = useCallback(async (instruction: string, body: string): Promise<string | null> => {
    const cfg = config.current;
    if (!cfg) return null;
    try {
      const res = await chat({
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: body },
        ],
        maxTokens: MAX_SUMMARY_TOKENS,
      });
      return res.text || null;
    } catch (e) {
      callbacks.current.onIssue?.(`agent · summary failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const transcriptOf = (s: Session): string =>
    s.turns.map((t) => `${t.role === 'user' ? 'Michael' : 'Eva'}: ${t.content}`).join('\n');

  /**
   * Close a session out to memory. The summary is what gets carried into later
   * conversations, so a session that left nothing worth keeping is archived
   * without one rather than with a hollow note.
   */
  const archive = useCallback(
    async (closing: Session, now: number): Promise<void> => {
      const body = closing.summary
        ? `Summary of the earlier part of this conversation:\n${closing.summary}\n\nThen:\n${transcriptOf(closing)}`
        : transcriptOf(closing);
      const summary = await complete(SUMMARIZE_SESSION, body);
      const keep = summary && summary.trim() !== NOTHING_TO_REMEMBER ? summary.trim() : null;
      await archiveSession(closing, keep, now);
      memories.current = await recentMemories(MEMORY_LIMIT);
      if (keep) callbacks.current.onIssue?.('agent · remembered this conversation');
    },
    [complete],
  );

  // Bring-up: credentials, then the live session — archiving it first if the
  // device has been quiet long enough that it counts as a finished conversation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const credentials = envAgentInput() ?? (await getAgentConfig());
      // The model is resolved separately from the credentials on purpose —
      // see resolveModel. Whichever source the key came from, an overlay
      // choice outranks the model that came bundled with it.
      const cfg = credentials ? { ...credentials, model: await resolveModel() } : null;
      if (cancelled) return;
      config.current = cfg;
      setModel(cfg?.model ?? null);
      setStatus(cfg ? 'ready' : 'unconfigured');
      if (!cfg) {
        callbacks.current.onIssue?.('agent · no API key configured');
        return;
      }

      const loaded = await loadSession();
      if (cancelled) return;
      const now = Date.now();
      if (loaded && isGap(loaded, now)) {
        session.current = newSession(now);
        await saveSession(session.current);
        await archive(loaded, now); // needs the key, so it waits for bring-up
      } else {
        session.current = loaded ?? newSession(now);
        memories.current = await recentMemories(MEMORY_LIMIT);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archive]);

  /**
   * Fold the oldest turns into the running summary. Runs after the round has
   * already been answered — never in its critical path — and drops by count so
   * anything the user said meanwhile survives (see applyCompaction).
   */
  const compact = useCallback(async (): Promise<void> => {
    if (compacting.current) return;
    const current = session.current;
    if (!current) return;
    const plan = planCompaction(current);
    if (!plan) return;

    compacting.current = true;
    try {
      const body = current.summary
        ? `Summary so far:\n${current.summary}\n\nNewer exchanges to fold in:\n${transcriptOf({ ...current, turns: plan.fold })}`
        : transcriptOf({ ...current, turns: plan.fold });
      const summary = await complete(SUMMARIZE_TURNS, body);
      if (!summary || !session.current) return;
      session.current = applyCompaction(session.current, plan.foldCount, summary);
      await saveSession(session.current);
      callbacks.current.onIssue?.(`agent · compacted ${plan.foldCount} turns`);
    } finally {
      compacting.current = false;
    }
  }, [complete]);

  /**
   * Send the utterance to the model and resolve with its reply. Resolves with
   * exactly one outcome. `useEcho`'s epoch guard protects the *speaker* — it
   * stops a superseded round's deltas and callbacks reaching the face — but
   * durable state needs its own guard, since nothing outside this hook holds
   * the abandoned request's controller: that's what `askGen` is for.
   */
  const ask = useCallback(
    async (text: string, opts?: AskOptions): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I don't have a brain configured right now." };

      const gen = ++askGen.current;
      // A new round supersedes the old one: stop the previous request streaming
      // (and being billed), and stop its deltas arriving.
      inFlight.current?.abort();

      const postedAt = Date.now();
      const asked = appendTurn(session.current ?? newSession(postedAt), { role: 'user', content: text }, postedAt);
      session.current = asked;

      const controller = new AbortController();
      inFlight.current = controller;
      let timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
      let usage: ChatUsage | null = null;
      // Text handed to the speaker so far. On a mid-stream failure this is
      // what Eva actually said, so it is what goes into history.
      let streamed = '';
      // Set when a tool hands back an image; becomes the turn's photo below.
      let photo: Photo | undefined;

      /**
       * Run a gate with the round's clock stopped.
       *
       * The 30s budget is sized for a model and a network, not for a person
       * looking up from what they were doing — a spoken consent gate can spend
       * half of it before anyone has said a word, and the first-use iOS
       * permission dialog can spend all of it. Same reasoning as `speech.hold`
       * suspending audioOut's stall watchdog: the wait is expected, so the
       * thing watching for a hang has to be told.
       */
      const gated = async <T,>(fn: () => Promise<T>): Promise<T> => {
        clearTimeout(timer);
        try {
          return await fn();
        } finally {
          timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
        }
      };

      try {
        const bundle = callbacks.current.bundleText?.(postedAt) ?? null;
        const messages: RequestMessage[] = buildRequest(
          PERSONA,
          memories.current,
          asked,
          callbacks.current.resolvePhoto,
          bundle,
        );
        let raw = '';
        if (__DEV__) {
          // The exact request, because "she declined" and "she was never asked"
          // look identical from the outside. The heard text matters most: it
          // arrives through speech-to-text and may not be the question that
          // was actually spoken.
          console.log(
            `[agent] ask "${text}" · ${asked.turns.length} turns · ${memories.current.length} memories · ${tools.current.specs.length} tools · bundle ${bundle ? 'yes' : 'no'}`,
          );
        }

        // Every lap streams. Content deltas go straight to the speaker, which
        // is also how the preamble ("let me look that up") is delivered: the
        // model emits it as ordinary content on the same response as the tool
        // call, so it is already being spoken by the time the tool runs.
        for (let step = 0; step < MAX_STEPS; step++) {
          // The last lap is offered no tools, which forces an answer out of
          // whatever has been gathered. Without this a model that kept calling
          // tools would exhaust the loop having said nothing at all — after
          // promising out loud that it was looking something up. The dropped
          // specs cost this one lap its cached prefix; that is a fair price on
          // a round that has already gone wrong.
          const res = await chatStream({
            apiKey: cfg.apiKey,
            model: cfg.model,
            messages,
            tools: step === MAX_STEPS - 1 ? [] : tools.current.specs,
            signal: controller.signal,
            maxTokens: MAX_REPLY_TOKENS,
            onDelta: (delta) => {
              streamed += delta;
              opts?.onDelta?.(delta);
            },
          });
          // Usage is per-lap, and a tool round has several. Summing is the only
          // honest headline number; the last lap alone hides the tool traffic.
          usage = addUsage(usage, res.usage);

          if (!res.toolCalls.length) {
            // A turn that reached no tool answered from what was already
            // resident — the bundle, memory, or the conversation. That ratio is
            // the health metric the whole bridge is judged on, and it is
            // measured here rather than declared by the model.
            if (step === 0) recall.current.direct += 1;
            if (__DEV__) console.log(`[agent] lap ${step}: no tool call, answered directly`);
            raw = res.text;
            break;
          }

          if (step === 0) recall.current.tool += 1;
          // Tell the speaker the reply is about to pause. Everything spoken so
          // far was the preamble; what comes back after this is the answer.
          opts?.onToolStart?.(res.toolCalls.map((c) => c.name));
          messages.push(res.message);
          for (const call of res.toolCalls) {
            const startedAt = Date.now();
            const answered = await tools.current.run(call, {
              signal: controller.signal,
              onConsent: opts?.onConsent ? () => gated(opts.onConsent!) : undefined,
            });
            if (__DEV__) {
              // The gap this prints is the one the speech hold has to cover.
              const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
              console.log(
                `[agent] tool ${call.name}(${call.arguments}) → ${secs}s, ${answered.message.content.length} chars: ${answered.message.content.slice(0, 90)}`,
              );
            }
            messages.push(answered.message);
            // An image cannot ride on a tool message, so it follows as a user
            // turn. Kept out of `session` until the round resolves — a round
            // that dies here should not leave a photo in the conversation.
            if (answered.photo) {
              photo = answered.photo;
              messages.push({
                role: 'user',
                content: [
                  { type: 'text', text: PHOTO_MESSAGE },
                  { type: 'image_url', image_url: { url: answered.photo.dataUrl } },
                ],
              });
            }
          }
          // The preamble was spoken, not answered with — it belongs to the
          // tool lap we are about to discard, so it must not become history.
          streamed = '';
        }

        const replyAt = Date.now();
        if (usage) {
          const { direct, tool } = recall.current;
          const total = direct + tool;
          const rate = total ? ` · ${Math.round((direct / total) * 100)}% direct` : '';
          callbacks.current.onUsage?.(`agent · ${formatUsage(usage)}${rate}`);
        }
        if (!raw) return { kind: 'error', message: 'agent · empty reply' };

        // The user turn stays: Michael really did say it. The assistant turn does
        // not, because a newer round is already the live conversation and
        // appending here would place this answer after the newer question.
        if (gen !== askGen.current) return { kind: 'error', message: 'agent · superseded' };

        // The photo goes in ahead of the answer that describes it, and carries
        // only an id and a caption — the bytes stay in the vision window, which
        // is what keeps base64 out of everything store.ts writes to disk. The
        // caption comes from Eva's own reply, so once the image ages out the
        // turn still says what was in it.
        if (photo) {
          session.current = appendTurn(
            session.current ?? asked,
            { role: 'user', content: PHOTO_MESSAGE, photo: { id: photo.id, caption: captionFor(raw) } },
            replyAt,
          );
        }
        session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: raw }, replyAt);
        await saveSession(session.current);
        // After the answer is on its way to the speaker, never before it.
        void compact();

        return { kind: 'reply', raw, speakable: speakableFromMrkdwn(raw), postedAt, replyAt };
      } catch (e) {
        if (streamed) {
          if (gen !== askGen.current) return { kind: 'error', message: 'agent · superseded' };
          // Part of the reply is already audible. Record what was said so the
          // conversation stays coherent, and let the spoken part stand.
          session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: streamed }, Date.now());
          await saveSession(session.current);
          return { kind: 'error', message: 'agent · stream failed mid-reply' };
        }
        if (controller.signal.aborted) return { kind: 'timeout', postedAt };
        return { kind: 'error', message: `agent · ${e instanceof Error ? e.message : String(e)}` };
      } finally {
        clearTimeout(timer);
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [compact],
  );

  /**
   * Close out the conversation now instead of waiting for the gap. Exposed for
   * the dev overlay: it is the only way to exercise the archive-and-summarize
   * path without sitting still for thirty minutes.
   */
  const endSession = useCallback(async (): Promise<void> => {
    const closing = session.current;
    const now = Date.now();
    session.current = newSession(now);
    await saveSession(session.current);
    if (!closing || closing.turns.length === 0) {
      callbacks.current.onIssue?.('agent · nothing to end');
      return;
    }
    await archive(closing, now);
  }, [archive]);

  /**
   * Throw away every archived conversation and the live session.
   *
   * Not merely a tidy-up affordance: a memory written by an earlier version of
   * Eva can assert something about her that is no longer true, and a
   * remembered "I cannot look things up" reliably beats an instruction saying
   * she can — measured at 0/3 tool calls against 3/3 without it. The
   * summarizers no longer write such notes, but nothing rewrites the ones
   * already on disk, so there has to be a way to drop them.
   */
  const forgetAll = useCallback(async (): Promise<void> => {
    askGen.current++; // any round still in flight must not write history back
    inFlight.current?.abort();
    await clearAll();
    memories.current = [];
    session.current = newSession(Date.now());
    await saveSession(session.current);
    // Console as well as the transcript: whether this ran at all is the first
    // thing you need to know when Eva is still behaving like her old self.
    if (__DEV__) console.log('[agent] forgot everything — session and memory cleared');
    callbacks.current.onIssue?.('agent · forgot everything');
  }, []);

  /**
   * Step to the next model in MODEL_PRESETS, persist it, and use it from the
   * next round — no reload.
   *
   * Switching mid-session invalidates the cached prefix once, since the model
   * is part of the cache key. That is expected rather than a caching bug: the
   * next few turns rebuild it.
   */
  const cycleModel = useCallback(async (): Promise<void> => {
    const current = config.current?.model ?? null;
    const at = MODEL_PRESETS.indexOf((current ?? '') as (typeof MODEL_PRESETS)[number]);
    // An unlisted model (set through the env) lands at -1, so the first tap
    // moves to the head of the list rather than nowhere.
    const next = MODEL_PRESETS[(at + 1) % MODEL_PRESETS.length];
    await setModelOverride(next);
    if (config.current) config.current = { ...config.current, model: next };
    setModel(next);
    if (__DEV__) console.log(`[agent] model → ${next}`);
    callbacks.current.onIssue?.(`agent · model ${next}`);
  }, []);

  return { status, model, ask, endSession, forgetAll, cycleModel };
}
