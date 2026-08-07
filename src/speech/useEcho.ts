import { useCallback, useEffect, useRef } from 'react';
import type { FaceMode } from '../face/types';
import { formatLatency } from '../slack/latency';
import type { AskResult } from '../slack/protocol';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { speak, stopSpeaking } from './tts';

const THINK_BEAT_MS = 300;
const PLEASED_BEAT_MS = 600;
const CONFUSED_BEAT_MS = 1200;
const LOW_CONFIDENCE = 0.35;

const TIMEOUT_LINE = "Sorry — Eva hasn't answered yet. I'll keep an eye out.";
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
}

/**
 * The speech round choreographer: listen on demand, then either echo the
 * transcript back (Phase 1, no `ask`) or ask Eva and speak her reply.
 */
export function useEcho({ setMode, onHeard, onSaid, onPulse, onIssue, ask, onLatency }: EchoHandlers) {
  const active = useRef(false);
  const transcript = useRef('');
  const confidence = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round generation. Bumped by cancel/listen/ask entries; async continuations
  // capture it and bail when stale, so a cancelled round's in-flight network
  // reply can never grab the speaker.
  const epoch = useRef(0);
  const wokeAt = useRef<number | undefined>(undefined);
  // Live handler refs for the mount-once native event subscription.
  const handlers = useRef({ ask, onLatency });
  handlers.current = { ask, onLatency };

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

  const settle = useCallback(
    (via: FaceMode, ms: number) => {
      setMode(via);
      after(ms, () => setMode('idle'));
    },
    [after, setMode],
  );

  const sayBack = useCallback(
    (text: string) => {
      setMode('thinking');
      after(THINK_BEAT_MS, () => {
        onSaid?.(text);
        speak(text, {
          onStart: () => setMode('speaking'),
          onBoundary: () => onPulse?.(),
          onDone: () => settle('pleased', PLEASED_BEAT_MS),
          onError: () => settle('confused', CONFUSED_BEAT_MS),
        });
      });
    },
    [after, onPulse, onSaid, setMode, settle],
  );

  /** Speak a canned failure line, then settle through confused. */
  const sayProblem = useCallback(
    (text: string) => {
      onSaid?.(text);
      speak(text, {
        onStart: () => setMode('speaking'),
        onBoundary: () => onPulse?.(),
        onDone: () => settle('confused', CONFUSED_BEAT_MS),
        onError: () => settle('confused', CONFUSED_BEAT_MS),
      });
    },
    [onPulse, onSaid, setMode, settle],
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
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      const result = await doAsk(text);
      if (round !== epoch.current) return; // cancelled or superseded mid-flight
      switch (result.kind) {
        case 'reply': {
          const speakable = result.speakable || 'Eva replied with something I cannot say aloud.';
          onSaid?.(speakable);
          speak(speakable, {
            onStart: () => {
              setMode('speaking');
              handlers.current.onLatency?.(
                formatLatency({ ...marks, postedAt: result.postedAt, replyAt: result.replyAt, spokeAt: Date.now() }),
              );
            },
            onBoundary: () => onPulse?.(),
            onDone: () => settle('pleased', PLEASED_BEAT_MS),
            onError: () => settle('confused', CONFUSED_BEAT_MS),
          });
          break;
        }
        case 'timeout':
          handlers.current.onLatency?.(formatLatency({ ...marks, postedAt: result.postedAt }));
          sayProblem(TIMEOUT_LINE);
          break;
        case 'offline':
          sayProblem(OFFLINE_LINE);
          break;
        case 'error':
          onIssue?.(`Slack: ${result.message}`);
          settle('confused', CONFUSED_BEAT_MS);
          break;
      }
    },
    [clearTimer, onIssue, onPulse, onSaid, sayBack, sayProblem, setMode, settle],
  );

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
        if (code !== 'no-speech' && code !== 'aborted') onIssue?.(`STT ${code}: ${message}`);
        settle('confused', CONFUSED_BEAT_MS);
      },
      onEnd: () => {
        if (!active.current) return;
        active.current = false;
        const text = transcript.current.trim();
        const lowConf = confidence.current >= 0 && confidence.current < LOW_CONFIDENCE;
        if (!text || lowConf) {
          settle('confused', CONFUSED_BEAT_MS);
        } else {
          onHeard?.(text);
          if (handlers.current.ask) void askEva(text);
          else sayBack(text);
        }
      },
    });
    return () => {
      unsubscribe();
      clearTimer();
      abortListening();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start a listen round; wokeAtMs stamps wake-to-audio latency when set. */
  const listen = useCallback(
    async (wokeAtMs?: number) => {
      const round = ++epoch.current;
      wokeAt.current = wokeAtMs;
      const blocker = await ensureReady();
      if (round !== epoch.current) return;
      if (blocker) {
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
    [clearTimer, onIssue, setMode, settle],
  );

  /** Speak arbitrary text with full state choreography (dev "Speak test"). */
  const say = useCallback((text: string) => sayBack(text), [sayBack]);

  /** Typed question straight to Eva — the dev/simulator round path. */
  const askDirect = useCallback(
    (text: string) => {
      wokeAt.current = undefined;
      void askEva(text);
    },
    [askEva],
  );

  /** Abandon any in-flight listen/ask/speak and return control to the caller. */
  const cancel = useCallback(() => {
    epoch.current++;
    active.current = false;
    clearTimer();
    abortListening();
    stopSpeaking();
  }, [clearTimer]);

  return { listen, say, ask: askDirect, cancel };
}
