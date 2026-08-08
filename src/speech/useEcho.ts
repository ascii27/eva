import { useCallback, useEffect, useRef } from 'react';
import type { FaceMode } from '../face/types';
import { formatLatency } from '../slack/latency';
import type { AskResult } from '../slack/protocol';
import { decideAside, noteTool, openAside, type AsideState } from './asides';
import { type ConvWindow, decideNext } from './conversation';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { speak, stopSpeaking } from './tts';

const THINK_BEAT_MS = 300;
const PLEASED_BEAT_MS = 600;
const CONFUSED_BEAT_MS = 1200;
const LOW_CONFIDENCE = 0.35;

const TIMEOUT_LINE = "Sorry — Eva hasn't answered yet. Her reply will show up in the transcript.";
const OFFLINE_LINE = "I can't reach Slack right now.";

export interface EchoHandlers {
  setMode: (m: FaceMode) => void;
  /** Final transcript captured from the mic. */
  onHeard?: (text: string) => void;
  /** Text Eva spoke aloud. */
  onSaid?: (text: string) => void;
  /** Word-boundary pulse while speaking. */
  onPulse?: () => void;
  /** Human-readable failures (permissions, no on-device support, …). */
  onIssue?: (message: string) => void;
  /**
   * Phase 3: route captured speech to Eva and speak her reply. When absent
   * (unpaired device, Expo Go), rounds fall back to the Phase-1 echo.
   */
  ask?: (text: string) => Promise<AskResult>;
  /** Formatted round-latency line, emitted as the reply starts speaking. */
  onLatency?: (line: string) => void;
  /**
   * Continuous conversation: after a spoken reply on a mic-originated round,
   * keep re-opening the mic for follow-ups until the window lapses silently.
   */
  conversation?: boolean;
  /** Spoken asides (opener, fillers, tool narration) during the ask wait. */
  asides?: boolean;
}

/**
 * The speech round choreographer: listen on demand, then either echo the
 * transcript back (Phase 1, no `ask`) or ask Eva and speak her reply.
 */
export function useEcho({ setMode, onHeard, onSaid, onPulse, onIssue, ask, onLatency, conversation, asides }: EchoHandlers) {
  const active = useRef(false);
  const transcript = useRef('');
  const confidence = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round generation. Bumped by cancel/listen/ask entries; async continuations
  // capture it and bail when stale, so a cancelled round's in-flight network
  // reply can never grab the speaker.
  const epoch = useRef(0);
  const wokeAt = useRef<number | undefined>(undefined);
  // Follow-up window deadline (null = closed) and whether the current round
  // originated from the mic — dev Speak/Ask rounds must never hot-mic after.
  const convWindow = useRef<ConvWindow>(null);
  const voiceRound = useRef(false);
  // Aside machinery: pure decision state + the coarse tick driving it.
  // Non-null timer doubles as "this round still owns the thinking wait".
  const asideState = useRef<AsideState | null>(null);
  const asideTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Live handler refs for the mount-once native event subscription.
  const handlers = useRef({ ask, onLatency, conversation, asides });
  handlers.current = { ask, onLatency, conversation, asides };

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const after = useCallback(
    (ms: number, fn: () => void) => {
      clearTimer();
      timer.current = setTimeout(fn, ms);
    },
    [clearTimer],
  );

  const clearAsides = useCallback(() => {
    if (asideTimer.current) clearInterval(asideTimer.current);
    asideTimer.current = null;
    asideState.current = null;
  }, []);

  /**
   * Speak a short aside without round consequences: face flips to speaking
   * for the utterance, then back to thinking — but only while the aside
   * timer is still armed, so an aside interrupted by the real reply (speak()
   * stops it, which reports done) can't stomp the reply's choreography.
   */
  const speakAside = useCallback(
    (text: string) => {
      const round = epoch.current;
      const live = () => round === epoch.current;
      speak(text, {
        onStart: () => {
          if (live() && asideTimer.current) setMode('speaking');
        },
        onBoundary: () => {
          if (live()) onPulse?.();
        },
        onDone: () => {
          if (live() && asideTimer.current) setMode('thinking');
        },
        onError: () => {
          if (live() && asideTimer.current) setMode('thinking');
        },
      });
    },
    [onPulse, setMode],
  );

  /** Tool-echo activity from Slack; the next due aside narrates it. */
  const noteToolActivity = useCallback((label: string) => {
    if (asideState.current) asideState.current = noteTool(asideState.current, label);
  }, []);

  const settle = useCallback(
    (via: FaceMode, ms: number) => {
      setMode(via);
      after(ms, () => setMode('idle'));
    },
    [after, setMode],
  );

  /** Open the mic for one command session; wokeAtMs stamps wake-to-audio latency. */
  const openMic = useCallback(
    async (wokeAtMs?: number) => {
      const round = ++epoch.current;
      clearAsides();
      wokeAt.current = wokeAtMs;
      const blocker = await ensureReady();
      if (round !== epoch.current) return;
      if (blocker) {
        convWindow.current = null;
        onIssue?.(blocker);
        settle('confused', CONFUSED_BEAT_MS);
        return;
      }
      // Give the TTS audio session time to fully deactivate — starting the
      // recognizer mid-teardown surfaces as an "interrupted" error on iOS.
      stopSpeaking();
      await new Promise((r) => setTimeout(r, 300));
      if (round !== epoch.current) return;
      transcript.current = '';
      confidence.current = -1;
      active.current = true;
      clearTimer();
      setMode('listening');
      startListening();
    },
    [clearAsides, clearTimer, onIssue, setMode, settle],
  );

  /**
   * Speak with full face choreography, settling through `via` on completion.
   * Every callback is bound to the current round: expo-speech reports a
   * stopped utterance as done (tts.ts aliases onStopped → onDone), so without
   * the guard a cancelled utterance would settle a *newer* round's face mode.
   */
  const deliver = useCallback(
    (text: string, via: 'pleased' | 'confused', onStarted?: () => void) => {
      const round = epoch.current;
      const live = () => round === epoch.current;
      onSaid?.(text);
      speak(text, {
        onStart: () => {
          if (!live()) return;
          setMode('speaking');
          onStarted?.();
        },
        onBoundary: () => {
          if (live()) onPulse?.();
        },
        onDone: () => {
          if (!live()) return;
          if (via === 'pleased' && voiceRound.current && handlers.current.conversation) {
            // Follow-up window: pleased beat doubles as the "your turn" cue,
            // then re-open the mic instead of settling to idle.
            convWindow.current = decideNext('reply-delivered', Date.now(), convWindow.current).window;
            setMode('pleased');
            after(PLEASED_BEAT_MS, () => void openMic());
          } else {
            settle(via, via === 'pleased' ? PLEASED_BEAT_MS : CONFUSED_BEAT_MS);
          }
        },
        onError: () => {
          if (live()) settle('confused', CONFUSED_BEAT_MS);
        },
      });
    },
    [after, onPulse, onSaid, openMic, setMode, settle],
  );

  const sayBack = useCallback(
    (text: string) => {
      setMode('thinking');
      after(THINK_BEAT_MS, () => deliver(text, 'pleased'));
    },
    [after, deliver, setMode],
  );

  /** The Phase-3 round: post to Eva, hold thinking for the real wait, speak. */
  const askEva = useCallback(
    async (text: string) => {
      const doAsk = handlers.current.ask;
      if (!doAsk) {
        sayBack(text);
        return;
      }
      const round = ++epoch.current;
      clearAsides();
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      if (handlers.current.asides) {
        const opened = openAside(Date.now(), Math.random());
        asideState.current = opened.state;
        speakAside(opened.say);
        // Coarse 1s tick; decideAside owns the real cadence. The interval
        // (not a chained timeout) keeps ticking across long Kokoro syntheses.
        asideTimer.current = setInterval(() => {
          if (!asideState.current) return;
          const d = decideAside(Date.now(), asideState.current, Math.random());
          asideState.current = d.state;
          if (d.say) speakAside(d.say);
        }, 1_000);
      }
      try {
        const result = await doAsk(text);
        if (round !== epoch.current) return; // cancelled or superseded mid-flight; owner already cleared our asides
        clearAsides(); // before deliver(), so a settling aside can't flip the mode back
        if (result.kind !== 'reply') {
          convWindow.current = decideNext('ask-failed', Date.now(), convWindow.current).window;
        }
        switch (result.kind) {
          case 'reply': {
            const speakable = result.speakable || 'Eva replied with something I cannot say aloud.';
            deliver(speakable, 'pleased', () =>
              handlers.current.onLatency?.(
                formatLatency({ ...marks, postedAt: result.postedAt, replyAt: result.replyAt, spokeAt: Date.now() }),
              ),
            );
            break;
          }
          case 'timeout':
            handlers.current.onLatency?.(formatLatency({ ...marks, postedAt: result.postedAt }));
            deliver(TIMEOUT_LINE, 'confused');
            break;
          case 'offline':
            deliver(OFFLINE_LINE, 'confused');
            break;
          case 'error':
            stopSpeaking(); // a lingering or queued aside must not talk over (or hijack) the confused face
            onIssue?.(`Slack: ${result.message}`);
            settle('confused', CONFUSED_BEAT_MS);
            break;
        }
      } finally {
        // Safety net: an ask handler that rejects instead of resolving would
        // otherwise leak the interval and narrate fillers forever. Idempotent
        // with the explicit clearAsides() above; the round guard preserves
        // the invariant that a superseded round never clears a newer one's timer.
        if (round === epoch.current) clearAsides();
      }
    },
    [clearAsides, clearTimer, deliver, onIssue, sayBack, setMode, settle, speakAside],
  );

  /**
   * A listen session ended with nothing usable (silence or low confidence).
   * Inside an open follow-up window: silently re-listen or quietly drop to
   * idle at expiry — no confused flash for ambient chatter. The confused beat
   * stays exclusive to the wake-gated first listen, where the user explicitly
   * addressed Eva and deserves failure feedback.
   */
  const onNoSpeech = useCallback(() => {
    const inWindow = handlers.current.conversation && convWindow.current !== null;
    const d = decideNext('empty-listen', Date.now(), inWindow ? convWindow.current : null);
    convWindow.current = d.window;
    if (d.next === 'listen-again') void openMic();
    else if (inWindow) setMode('idle');
    else settle('confused', CONFUSED_BEAT_MS);
  }, [openMic, setMode, settle]);

  useEffect(() => {
    const unsubscribe = addListeners({
      onResult: (r) => {
        if (!active.current) return;
        transcript.current = r.transcript;
        confidence.current = r.confidence;
      },
      onError: (code, message) => {
        if (!active.current) return;
        active.current = false;
        // iOS often reports a fully-silent command session as no-speech
        // before end, so the follow-up window branch must exist here too.
        if (code === 'no-speech') {
          onNoSpeech();
          return;
        }
        convWindow.current = null;
        if (code !== 'aborted') onIssue?.(`STT ${code}: ${message}`);
        settle('confused', CONFUSED_BEAT_MS);
      },
      onEnd: () => {
        if (!active.current) return;
        active.current = false;
        const text = transcript.current.trim();
        const lowConf = confidence.current >= 0 && confidence.current < LOW_CONFIDENCE;
        if (!text || lowConf) {
          onNoSpeech();
        } else {
          onHeard?.(text);
          if (handlers.current.ask) void askEva(text);
          else sayBack(text);
        }
      },
    });
    return () => {
      unsubscribe();
      // stopSpeaking reports the interrupted utterance as done synchronously;
      // bump the epoch first (like cancel()) so deliver's callbacks see a dead
      // round instead of re-arming timers on the unmounting tree.
      epoch.current++;
      clearAsides();
      convWindow.current = null;
      voiceRound.current = false;
      clearTimer();
      abortListening();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start a voice round; wokeAtMs stamps wake-to-audio latency when set. */
  const listen = useCallback(
    async (wokeAtMs?: number) => {
      voiceRound.current = true;
      convWindow.current = null;
      await openMic(wokeAtMs);
    },
    [openMic],
  );

  /** Speak arbitrary text with full state choreography (dev "Speak test"). */
  const say = useCallback(
    (text: string) => {
      voiceRound.current = false;
      convWindow.current = null;
      sayBack(text);
    },
    [sayBack],
  );

  /** Typed question straight to Eva — the dev/simulator round path. */
  const askDirect = useCallback(
    (text: string) => {
      voiceRound.current = false;
      convWindow.current = null;
      wokeAt.current = undefined;
      void askEva(text);
    },
    [askEva],
  );

  /** Abandon any in-flight listen/ask/speak and return control to the caller. */
  const cancel = useCallback(() => {
    epoch.current++;
    clearAsides();
    active.current = false;
    convWindow.current = null;
    voiceRound.current = false;
    clearTimer();
    abortListening();
    stopSpeaking();
  }, [clearAsides, clearTimer]);

  return { listen, say, ask: askDirect, cancel, noteToolActivity };
}
