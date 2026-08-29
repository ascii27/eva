// The realtime brain: the same round contract as the chat brain and Slack,
// over a socket that is only alive while someone is talking.
//
// Owned by FaceScreen, mirroring useAgent and useSlack. ask(text) resolves to
// exactly one AskResult, so useEcho still cannot tell which brain answered —
// that indifference is the whole reason this could be built without touching
// the speech layer at all.
//
// What differs from useAgent is where the conversation lives. Chat completions
// keeps nothing, so every lap re-uploads the whole transcript; here the server
// holds it for the life of the socket and each turn sends only what is new.
// That is a bandwidth and latency win rather than a token one — the model is
// still charged for the whole conversation on every response — and it is worth
// roughly 600ms of silence at the start of each answer (see models.ts).
//
// The socket opens on the wake word and closes once the conversation lapses,
// so the server-side conversation is short-lived. `Session` in history.ts is
// still the durable record, and the rule for keeping the two honest is: the
// socket is a cache, Session is truth. Anything that edits Session structurally
// — compaction, ending it, forgetting everything — drops the socket rather than
// trying to reconcile the two.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskOptions, AskResult } from '../round/ask';
import { speakableFromMrkdwn } from '../round/speakable';
import {
  type AgentConfig,
  DEFAULT_MODEL,
  REALTIME_MODEL_PRESETS,
  envAgentInput,
  envTavilyKey,
  getAgentConfig,
  resolveRealtimeModel,
  setRealtimeModelOverride,
} from '../agent/config';
import { captionFor, type Photo } from '../vision/photos';
import {
  appendTurn,
  applyCompaction,
  buildRequest,
  type BundleText,
  MEMORY_LIMIT,
  newSession,
  planCompaction,
  type PhotoResolver,
  type Session,
} from '../agent/history';
import { chat, type ChatUsage, formatUsage, type ToolCall } from '../agent/openai';
import { addSpend, emptySpend, formatSpend, type Spend } from '../agent/spend';
import { NOTHING_TO_REMEMBER, PERSONA, SUMMARIZE_SESSION, SUMMARIZE_TURNS } from '../agent/persona';
import { archiveSession, clearAll, loadSession, recentMemories, saveSession } from '../agent/store';
import { buildToolKit, type ErrandHandles, type ToolKit, type VisionHandles } from '../agent/tools';
import {
  assistantText,
  deleteItem,
  functionOutput,
  photoItemId,
  responseCancel,
  responseCreate,
  seed,
  sessionUpdate,
  userImage,
  userText,
  type ServerEvent,
} from './protocol';
import { RealtimeSocket, type RealtimeStatus } from './socket';

/** Same budget as the chat brain: slower than this has gone wrong, not slow. */
export const ASK_TIMEOUT_MS = 30_000;

/**
 * How long a round will wait for a socket. Wake dials seconds before anyone
 * stops talking, so this is only ever paid when the dial itself is struggling —
 * at which point a spoken failure beats a longer silence.
 */
const READY_TIMEOUT_MS = 8_000;

/** A preamble, a tool, a second tool, an answer. Past that she is circling. */
const MAX_STEPS = 4;

/** Deliberate silence after we cancel: long enough to be tidy, not to be felt. */
const CANCEL_GRACE_MS = 1_500;

const MAX_SUMMARY_TOKENS = 300;

/** In Michael's voice: the image reads as him showing her something. */
const PHOTO_MESSAGE = 'Here is the photo from the camera.';

function addUsage(a: ChatUsage | null, b: ChatUsage | null): ChatUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

/** How one response ended. `aborted` is the round's own clock running out. */
type Outcome =
  | { kind: 'done'; text: string; calls: { call: ToolCall; itemId: string }[]; usage: ChatUsage | null; status: string }
  | { kind: 'failed'; message: string }
  | { kind: 'aborted' };

/** The round currently allowed to hear from the socket. */
interface Collector {
  gen: number;
  onDelta(text: string): void;
  onTool(call: ToolCall, itemId: string): void;
  onDone(status: string, usage: ChatUsage | null): void;
  onError(message: string): void;
  /** Resolves when this response has stopped producing events, however it ended. */
  finished: Promise<void>;
}

let toolsLogged = false;

export type RealtimeBrainStatus = 'unconfigured' | 'ready';

export interface UseRealtimeOptions {
  onIssue?: (message: string) => void;
  onUsage?: (line: string) => void;
  vision?: VisionHandles | null;
  errands?: ErrandHandles | null;
  resolvePhoto?: PhotoResolver;
  bundleText?: (now: number) => BundleText | null;
}

export function useRealtime({
  onIssue,
  onUsage,
  vision = null,
  errands = null,
  resolvePhoto,
  bundleText,
}: UseRealtimeOptions = {}) {
  const [status, setStatus] = useState<RealtimeBrainStatus>('unconfigured');
  const [connection, setConnection] = useState<RealtimeStatus>('closed');
  const [model, setModel] = useState<string | null>(null);

  const config = useRef<AgentConfig | null>(null);
  // Built once, like the chat brain's. The reason differs — a realtime session
  // declares its tools once at session.update, so a list that moved between
  // turns would mean rewriting session config mid-conversation.
  const tools = useRef<ToolKit>(buildToolKit({ tavilyKey: envTavilyKey(), vision, errands }));
  if (__DEV__ && !toolsLogged) {
    toolsLogged = true;
    console.log(`[realtime] tools offered: ${tools.current.specs.map((s) => s.name).join(', ') || 'none'}`);
  }

  const socket = useRef<RealtimeSocket | null>(null);
  const session = useRef<Session | null>(null);
  const memories = useRef<string[]>([]);
  const compacting = useRef(false);
  const askGen = useRef(0);
  const collector = useRef<Collector | null>(null);
  const recall = useRef({ direct: 0, tool: 0 });
  // Cumulative token spend since launch. A realtime session is billed the whole
  // conversation on every response, so this is the number that says whether a
  // long conversation is getting expensive faster than a short one.
  const spend = useRef<Spend>(emptySpend(Date.now()));
  const photoSeq = useRef(0);
  /** Resolves once the session has been configured and seeded. */
  const seeded = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);

  const callbacks = useRef({ onIssue, onUsage, resolvePhoto, bundleText });
  callbacks.current = { onIssue, onUsage, resolvePhoto, bundleText };

  /**
   * The summarizers still go over HTTP.
   *
   * They are not part of any conversation — they run after a round has already
   * been answered, or after a session has ended, and putting them on the socket
   * would either pollute the live conversation or need an out-of-band response
   * on a connection that may be about to close. A plain completion is the
   * simpler thing that cannot interfere with what is being said out loud.
   */
  const complete = useCallback(async (instruction: string, body: string): Promise<string | null> => {
    const cfg = config.current;
    if (!cfg) return null;
    try {
      const res = await chat({
        apiKey: cfg.apiKey,
        // Not cfg.model: that is a realtime model id, and the realtime models
        // do not serve chat completions at all. The summarizers are ordinary
        // completions and belong on the ordinary default.
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: body },
        ],
        maxTokens: MAX_SUMMARY_TOKENS,
      });
      return res.text || null;
    } catch (e) {
      callbacks.current.onIssue?.(`realtime · summary failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const transcriptOf = (s: Session): string =>
    s.turns.map((t) => `${t.role === 'user' ? 'Michael' : 'Eva'}: ${t.content}`).join('\n');

  const archive = useCallback(
    async (closing: Session, now: number): Promise<void> => {
      const body = closing.summary
        ? `Summary of the earlier part of this conversation:\n${closing.summary}\n\nThen:\n${transcriptOf(closing)}`
        : transcriptOf(closing);
      const summary = await complete(SUMMARIZE_SESSION, body);
      const keep = summary && summary.trim() !== NOTHING_TO_REMEMBER ? summary.trim() : null;
      await archiveSession(closing, keep, now);
      memories.current = await recentMemories(MEMORY_LIMIT);
      if (keep) callbacks.current.onIssue?.('realtime · remembered this conversation');
    },
    [complete],
  );

  /** Route one server event to whichever round is entitled to it. */
  const onEvent = useCallback((ev: ServerEvent) => {
    const c = collector.current;
    switch (ev.kind) {
      case 'ready':
        // The greeting. Configuring and seeding here rather than on socket open
        // keeps the order the probe measured working.
        void flushSeed();
        return;
      case 'delta':
        c?.onDelta(ev.text);
        return;
      case 'tool-call':
        // This fires on cancelled and incomplete responses too, so a call can
        // arrive for a round that no longer exists. The collector is detached
        // the moment a round is superseded, which is what stops the tool from
        // being run at all — not merely stops its result being used.
        c?.onTool(ev.call, ev.itemId);
        return;
      case 'done':
        c?.onDone(ev.status, ev.usage);
        return;
      case 'error':
        if (c) c.onError(ev.message);
        else callbacks.current.onIssue?.(`realtime · ${ev.message}`);
        return;
      default:
        return;
    }
  }, []);

  /**
   * Configure and populate a freshly greeted session.
   *
   * `buildRequest` stays the single author of what Eva knows and in what order,
   * so this is a replay of the same request the chat brain would have sent,
   * mapped onto conversation items. The persona becomes session instructions;
   * everything else — remembered summaries, the hermes bundle, the turns so
   * far — becomes items, which is what lets a bundle refresh arrive as an item
   * rather than as a rewrite of session config.
   */
  const flushSeed = useCallback(async () => {
    const sock = socket.current;
    if (!sock) return;
    // Re-read before seeding. Both local brains are mounted at once and both
    // own a copy of the same session file, so the copy this hook loaded at
    // bring-up may be behind whatever the chat brain has been answering with.
    // Session is truth; this is where that rule is actually honoured.
    const fromDisk = await loadSession();
    if (fromDisk) session.current = fromDisk;
    memories.current = await recentMemories(MEMORY_LIMIT);
    if (sock.state !== 'open') return; // closed while we were reading
    const now = Date.now();
    const bundle = callbacks.current.bundleText?.(now) ?? null;
    const current = session.current ?? newSession(now);
    const request = buildRequest(PERSONA, memories.current, current, callbacks.current.resolvePhoto, bundle);
    const s = seed(request);
    sock.send(sessionUpdate({ instructions: s.instructions, specs: tools.current.specs }));
    for (const item of s.items) sock.send(item);
    if (__DEV__) {
      console.log(
        `[realtime] seeded · ${current.turns.length} turns · ${memories.current.length} memories · bundle ${bundle ? 'yes' : 'no'}`,
      );
    }
    seeded.current?.resolve(true);
  }, []);

  /**
   * Dial, if not already up. Called on the wake word, well before anyone has
   * finished speaking, so the handshake and the seed hide under the listening.
   * Calling it on a live socket is a no-op — wake fires far more often than a
   * conversation ends, and redialling would throw away the context in flight.
   */
  const connect = useCallback(() => {
    const cfg = config.current;
    if (!cfg) return;
    let sock = socket.current;
    if (!sock) {
      sock = new RealtimeSocket({
        apiKey: cfg.apiKey,
        model: cfg.model,
        onEvent,
        onStatus: setConnection,
      });
      socket.current = sock;
    }
    if (sock.state !== 'closed') return;
    let resolve: (ok: boolean) => void = () => {};
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    seeded.current = { promise, resolve };
    sock.open();
  }, [onEvent]);

  /** Let the conversation go. The next wake dials a fresh one. */
  const disconnect = useCallback(() => {
    if (!socket.current || socket.current.state === 'closed') return;
    if (__DEV__) console.log('[realtime] closing — the conversation has lapsed');
    socket.current.close();
    seeded.current?.resolve(false);
    seeded.current = null;
  }, []);

  // Bring-up, in the shape useAgent uses: credentials, then the live session,
  // archiving it first if the device has been quiet long enough to count as a
  // finished conversation. No socket is opened here — that waits for a wake.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const credentials = envAgentInput() ?? (await getAgentConfig());
      const realtimeModel = await resolveRealtimeModel();
      if (cancelled) return;
      config.current = credentials ? { ...credentials, model: realtimeModel } : null;
      setModel(config.current?.model ?? null);
      setStatus(config.current ? 'ready' : 'unconfigured');
      if (!config.current) {
        callbacks.current.onIssue?.('realtime · no API key configured');
        return;
      }
      // Load only. The mount-time gap archive belongs to useAgent alone, which
      // is mounted whichever brain is selected: both hooks running it would
      // summarize the same stale session twice and write it to memory twice.
      // Nothing is lost by deferring — the socket re-reads from disk before it
      // seeds, so by the time this brain answers anything it has whatever
      // useAgent decided.
      const loaded = await loadSession();
      if (cancelled) return;
      session.current = loaded ?? newSession(Date.now());
      memories.current = await recentMemories(MEMORY_LIMIT);
    })();
    return () => {
      cancelled = true;
      socket.current?.close();
    };
  }, [archive]);

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
      // Session is truth and it has just been rewritten; the socket is holding
      // the turns compaction folded away. Rather than reconcile the two, drop
      // it — the next wake reseeds from the compacted record. Doing this while
      // a round is speaking would cut it off, so it waits for a quiet socket,
      // which is the same condition the caller already fires compaction under.
      if (!collector.current) disconnect();
      callbacks.current.onIssue?.(`realtime · compacted ${plan.foldCount} turns`);
    } finally {
      compacting.current = false;
    }
  }, [complete, disconnect]);

  /** Stop whatever is being generated, and wait for the socket to agree. */
  const cancelInFlight = useCallback(async (): Promise<void> => {
    const dying = collector.current;
    if (!dying) return;
    collector.current = null; // detached first: nothing it says can be acted on
    socket.current?.send(responseCancel());
    await Promise.race([dying.finished, new Promise((r) => setTimeout(r, CANCEL_GRACE_MS))]);
  }, []);

  const ask = useCallback(
    async (text: string, opts?: AskOptions): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I don't have a brain configured right now." };

      const gen = ++askGen.current;
      await cancelInFlight();

      // Dialled before the turn is recorded, so the seed is the conversation as
      // it stood before this question — otherwise the socket would be given the
      // question twice, once in the seed and once as the turn.
      connect();
      const sock = socket.current;
      if (!sock) return { kind: 'offline' };
      // One budget covering both halves of being usable: the socket open, and
      // the session configured and seeded. A socket that opens and is then
      // never greeted would otherwise leave the round waiting forever, which
      // on this device means a face wedged in `thinking` and a deaf appliance.
      const lapsed = new Promise<boolean>((r) => setTimeout(() => r(false), READY_TIMEOUT_MS));
      const ready =
        (await Promise.race([sock.whenReady(READY_TIMEOUT_MS), lapsed])) &&
        (await Promise.race([seeded.current?.promise ?? Promise.resolve(false), lapsed]));
      if (!ready || gen !== askGen.current) return { kind: 'offline' };

      const postedAt = Date.now();
      const asked = appendTurn(session.current ?? newSession(postedAt), { role: 'user', content: text }, postedAt);
      session.current = asked;

      let usage: ChatUsage | null = null;
      let streamed = '';
      let photo: Photo | undefined;
      let photoItem: string | null = null;
      let timedOut = false;

      /** Fires the round's clock. Rearmed by `gated` around a human-speed wait. */
      let timer: ReturnType<typeof setTimeout> | null = null;
      const armClock = () => {
        timer = setTimeout(() => {
          timedOut = true;
          const c = collector.current;
          collector.current = null;
          socket.current?.send(responseCancel());
          c?.onError('timeout');
        }, ASK_TIMEOUT_MS);
      };
      const clearClock = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      armClock();

      /**
       * Run a gate with the round's clock stopped, and the socket's watchdog
       * with it. A person deciding whether Eva may look at something is not a
       * hang, and neither the ask budget nor the liveness watchdog can tell the
       * difference on its own.
       */
      const gated = async <T,>(fn: () => Promise<T>): Promise<T> => {
        clearClock();
        sock.hold(true);
        try {
          return await fn();
        } finally {
          sock.hold(false);
          armClock();
        }
      };

      /** Ask for one response and collect it. */
      const runResponse = (forced: boolean): Promise<Outcome> =>
        new Promise<Outcome>((resolve) => {
          let text = '';
          const calls: { call: ToolCall; itemId: string }[] = [];
          let settleFinished: () => void = () => {};
          const finished = new Promise<void>((r) => {
            settleFinished = r;
          });
          const settle = (out: Outcome) => {
            if (collector.current === c) collector.current = null;
            settleFinished();
            resolve(out);
          };
          const c: Collector = {
            gen,
            finished,
            onDelta: (delta) => {
              text += delta;
              streamed += delta;
              opts?.onDelta?.(delta);
            },
            onTool: (call, itemId) => calls.push({ call, itemId }),
            onDone: (statusOf, u) => settle({ kind: 'done', text, calls, usage: u, status: statusOf }),
            onError: (message) =>
              settle(timedOut ? { kind: 'aborted' } : { kind: 'failed', message }),
          };
          collector.current = c;
          sock.send(responseCreate({ toolChoice: forced ? 'none' : 'auto' }));
        });

      try {
        sock.send(userText(text));
        let raw = '';

        for (let step = 0; step < MAX_STEPS; step++) {
          // The last lap refuses tools, forcing an answer out of what has been
          // gathered. On the chat path that means dropping the specs from the
          // request and forfeiting its cached prefix; here it is a per-response
          // override, so session config never moves.
          const out = await runResponse(step === MAX_STEPS - 1);
          if (gen !== askGen.current) return { kind: 'error', message: 'realtime · superseded' };
          if (out.kind === 'aborted') return { kind: 'timeout', postedAt };
          if (out.kind === 'failed') {
            if (streamed) {
              session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: streamed }, Date.now());
              await saveSession(session.current);
              return { kind: 'error', message: `realtime · ${out.message}` };
            }
            return { kind: 'offline', message: "I've lost my connection to Eva." };
          }
          usage = addUsage(usage, out.usage);
          // Per response, because that is the unit the API bills. On a tool
          // round the input count climbs lap to lap as results are appended,
          // and watching it climb is the point.
          spend.current = addSpend(spend.current, out.usage, false);
          if (out.usage) {
            console.log(`[spend] realtime lap ${step} · ${formatUsage(out.usage)} · ${cfg.model}`);
          }

          if (!out.calls.length) {
            if (step === 0) recall.current.direct += 1;
            if (__DEV__) console.log(`[realtime] lap ${step}: answered directly`);
            raw = out.text;
            break;
          }

          if (step === 0) recall.current.tool += 1;
          opts?.onToolStart?.(out.calls.map((c) => c.call.name));
          for (const { call } of out.calls) {
            const startedAt = Date.now();
            const answered = await tools.current.run(call, {
              onConsent: opts?.onConsent ? (q?: string) => gated(() => opts.onConsent!(q)) : undefined,
            });
            if (gen !== askGen.current) return { kind: 'error', message: 'realtime · superseded' };
            if (__DEV__) {
              const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
              console.log(
                `[realtime] tool ${call.name}(${call.arguments}) → ${secs}s, ${answered.message.content.length} chars`,
              );
            }
            sock.send(functionOutput(call.id, answered.message.content));
            if (answered.photo) {
              photo = answered.photo;
              // Named now so it can be dropped when the round settles: an image
              // item is re-billed on every later response in the session, where
              // the chat path's vision window ages it out to prose.
              photoItem = photoItemId(++photoSeq.current);
              sock.send(userImage(answered.photo.dataUrl, PHOTO_MESSAGE, photoItem));
            }
          }
          // The preamble belongs to the lap being discarded, not to history.
          streamed = '';
        }

        const replyAt = Date.now();
        // Laps were folded in as they happened; this only closes the round.
        spend.current = addSpend(spend.current, null, true);
        console.log(`[spend] realtime round · ${usage ? formatUsage(usage) : 'no usage reported'}`);
        console.log(`[spend] realtime total · ${formatSpend(spend.current, replyAt)}`);
        if (usage) {
          const { direct, tool } = recall.current;
          const total = direct + tool;
          const rate = total ? ` · ${Math.round((direct / total) * 100)}% direct` : '';
          callbacks.current.onUsage?.(`realtime · ${formatUsage(usage)}${rate}`);
        }
        if (!raw) return { kind: 'error', message: 'realtime · empty reply' };
        if (gen !== askGen.current) return { kind: 'error', message: 'realtime · superseded' };

        if (photo) {
          session.current = appendTurn(
            session.current ?? asked,
            { role: 'user', content: PHOTO_MESSAGE, photo: { id: photo.id, caption: captionFor(raw) } },
            replyAt,
          );
        }
        session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: raw }, replyAt);
        await saveSession(session.current);
        // The bytes have done their job; the turn keeps the caption.
        if (photoItem) sock.send(deleteItem(photoItem));
        void compact();

        return { kind: 'reply', raw, speakable: speakableFromMrkdwn(raw), postedAt, replyAt };
      } catch (e) {
        if (streamed && gen === askGen.current) {
          session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: streamed }, Date.now());
          await saveSession(session.current);
          return { kind: 'error', message: 'realtime · stream failed mid-reply' };
        }
        return { kind: 'error', message: `realtime · ${e instanceof Error ? e.message : String(e)}` };
      } finally {
        clearClock();
        if (collector.current?.gen === gen) collector.current = null;
      }
    },
    [cancelInFlight, compact, connect],
  );

  /**
   * Record something Eva said that no round produced — an errand answer coming
   * back minutes after the question, spoken through the proactive queue.
   *
   * Without this the conversation has a hole in it: she says "coming back to
   * what you asked about Thursday…" out loud, and then has no idea she did.
   * It goes into Session either way, so it survives the socket being shut, and
   * into the live conversation as well when one is up.
   */
  const note = useCallback(async (text: string): Promise<void> => {
    const now = Date.now();
    session.current = appendTurn(session.current ?? newSession(now), { role: 'assistant', content: text }, now);
    await saveSession(session.current);
    if (socket.current?.state === 'open' && !collector.current) socket.current.send(assistantText(text));
  }, []);

  const endSession = useCallback(async (): Promise<void> => {
    const closing = session.current;
    const now = Date.now();
    session.current = newSession(now);
    await saveSession(session.current);
    disconnect(); // the socket holds the conversation that just ended
    if (!closing || closing.turns.length === 0) {
      callbacks.current.onIssue?.('realtime · nothing to end');
      return;
    }
    await archive(closing, now);
  }, [archive, disconnect]);

  const forgetAll = useCallback(async (): Promise<void> => {
    askGen.current++;
    collector.current = null;
    disconnect();
    await clearAll();
    memories.current = [];
    session.current = newSession(Date.now());
    await saveSession(session.current);
    if (__DEV__) console.log('[realtime] forgot everything — session and memory cleared');
    callbacks.current.onIssue?.('realtime · forgot everything');
  }, [disconnect]);

  /**
   * Step to the next realtime model. Takes effect on the next dial rather than
   * the next round: the model is fixed in the connection's URL, so the live
   * socket is dropped instead of being asked to change what it is.
   */
  const cycleModel = useCallback(async (): Promise<void> => {
    const current = config.current?.model ?? null;
    const at = REALTIME_MODEL_PRESETS.indexOf((current ?? '') as (typeof REALTIME_MODEL_PRESETS)[number]);
    const next = REALTIME_MODEL_PRESETS[(at + 1) % REALTIME_MODEL_PRESETS.length];
    await setRealtimeModelOverride(next);
    if (config.current) config.current = { ...config.current, model: next };
    setModel(next);
    disconnect();
    socket.current = null; // the model lives in the url, so the socket is rebuilt
    if (__DEV__) console.log(`[realtime] model → ${next}`);
    callbacks.current.onIssue?.(`realtime · model ${next}`);
  }, [disconnect]);

  return { status, connection, model, ask, connect, disconnect, note, endSession, forgetAll, cycleModel };
}
