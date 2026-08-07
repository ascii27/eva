import { useCallback, useEffect, useRef } from 'react';
import type { FaceMode } from '../face/types';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { speak, stopSpeaking } from './tts';

const THINK_BEAT_MS = 300;
const PLEASED_BEAT_MS = 600;
const CONFUSED_BEAT_MS = 1200;
const LOW_CONFIDENCE = 0.35;

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
}

/**
 * Phase-1 verification loop: wake nothing, just listen on demand and speak the
 * transcript back. Exercises STT → thinking → TTS with real state transitions.
 */
export function useEcho({ setMode, onHeard, onSaid, onPulse, onIssue }: EchoHandlers) {
  const active = useRef(false);
  const transcript = useRef('');
  const confidence = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          sayBack(text);
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

  /** Start a listen → echo round. */
  const listen = useCallback(async () => {
    const blocker = await ensureReady();
    if (blocker) {
      onIssue?.(blocker);
      settle('confused', CONFUSED_BEAT_MS);
      return;
    }
    // Give the TTS audio session time to fully deactivate — starting the
    // recognizer mid-teardown surfaces as an "interrupted" error on iOS.
    stopSpeaking();
    await new Promise((r) => setTimeout(r, 300));
    transcript.current = '';
    confidence.current = -1;
    active.current = true;
    clearTimer();
    setMode('listening');
    startListening();
  }, [clearTimer, onIssue, setMode, settle]);

  /** Speak arbitrary text with full state choreography (dev "Speak test"). */
  const say = useCallback((text: string) => sayBack(text), [sayBack]);

  /** Abandon any in-flight listen/speak and return control to the caller. */
  const cancel = useCallback(() => {
    active.current = false;
    clearTimer();
    abortListening();
    stopSpeaking();
  }, [clearTimer]);

  return { listen, say, cancel };
}
