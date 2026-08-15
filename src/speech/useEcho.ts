import { useCallback, useEffect, useRef } from 'react';
import type { FaceMode } from '../face/types';
import { type AskOptions, type AskResult, formatLatency } from '../round/ask';
import { emptySentences, flushPending, pushText, type SentenceState } from '../round/sentences';
import { beginAside, decideAside, noteTool, type AsideState } from './asides';
import { type ConvWindow, decideNext } from './conversation';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { speak, speakStream, stopSpeaking, type SpeechStream } from './tts';

const THINK_BEAT_MS = 300;
const ALERT_BEAT_MS = 600;
const PLEASED_BEAT_MS = 600;
const CONFUSED_BEAT_MS = 1200;
const LOW_CONFIDENCE = 0.35;

// Generic fallbacks. Each transport may supply its own copy on the result —
// the Slack path's "her reply will show up in the transcript" only makes sense
// for an async channel, and the local agent has nothing to reach.
const TIMEOUT_LINE = "Sorry — I didn't get an answer in time.";
const OFFLINE_LINE = "I can't reach Eva right now.";
/**
 * Said only when a round broke after Eva promised to do something and before
 * she said anything else — a tool call that failed on its way to an answer.
 * `error.message` is a diagnostic for the transcript, not a line to speak.
 */
const FAILED_LINE = "Sorry — that didn't work out.";

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
   * Route captured speech to Eva and speak her reply. When absent (unpaired
   * device, no API key, Expo Go), rounds fall back to the Phase-1 echo.
   */
  ask?: (text: string, opts?: AskOptions) => Promise<AskResult>;
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
  // earns follow-ups — true for mic-originated rounds and for Eva's proactive
  // announcements; dev Speak/Ask rounds must never hot-mic after.
  const convWindow = useRef<ConvWindow>(null);
  const voiceRound = useRef(false);
  // Aside machinery: pure decision state + the coarse tick driving it.
  // Non-null timer doubles as "this round still owns the thinking wait".
  const asideState = useRef<AsideState | null>(null);
  const asideTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Streaming delivery. Non-null once the first delta of a round has arrived,
  // which is also the signal that this round is being spoken incrementally
  // rather than as one finished utterance.
  const speech = useRef<SpeechStream | null>(null);
  const sentences = useRef<SentenceState>(emptySentences());
  /** Text actually handed to the speaker, for onSaid on a failed stream. */
  const spoken = useRef('');
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

  /** Drop both cosmetic asides and any open streaming utterance. */
  const clearRoundSpeech = useCallback(() => {
    if (asideTimer.current) clearInterval(asideTimer.current);
    asideTimer.current = null;
    asideState.current = null;
    speech.current = null;
    sentences.current = emptySentences();
    spoken.current = '';
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
      clearRoundSpeech();
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
    [clearRoundSpeech, clearTimer, onIssue, setMode, settle],
  );

  /**
   * A reply finished playing. Either open the follow-up window and re-arm the
   * mic, or settle the face. Shared by the whole-utterance and streaming paths.
   */
  const finishSpoken = useCallback(
    (round: number, via: 'pleased' | 'confused') => {
      if (round !== epoch.current) return;
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
    [after, openMic, setMode, settle],
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
        onDone: () => finishSpoken(round, via),
        onError: () => {
          if (live()) settle('confused', CONFUSED_BEAT_MS);
        },
      });
    },
    [finishSpoken, onPulse, onSaid, settle],
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
      clearRoundSpeech();
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      const postedAt = Date.now();
      let firstDeltaAt: number | undefined;

      if (handlers.current.asides) {
        asideState.current = beginAside(postedAt);
        // Coarse 1s tick; decideAside owns the real cadence, including whether
        // the wait has lasted long enough to deserve an opener at all. The
        // interval (not a chained timeout) keeps ticking across long Kokoro
        // syntheses.
        asideTimer.current = setInterval(() => {
          if (!asideState.current) return;
          const d = decideAside(Date.now(), asideState.current, Math.random());
          asideState.current = d.state;
          if (d.say) speakAside(d.say);
        }, 1_000);
      }

      /** First delta of the round: stop narrating and start speaking for real. */
      const openSpeech = () => {
        if (speech.current) return;
        firstDeltaAt = Date.now();
        // An aside must not talk over the reply, and its settling onDone must
        // not flip the mode back to thinking mid-answer.
        if (asideTimer.current) clearInterval(asideTimer.current);
        asideTimer.current = null;
        asideState.current = null;
        stopSpeaking();
        speech.current = speakStream({
          onStart: () => {
            if (round !== epoch.current) return;
            setMode('speaking');
            handlers.current.onLatency?.(
              formatLatency({ ...marks, postedAt, replyAt: firstDeltaAt, spokeAt: Date.now() }),
            );
          },
          onBoundary: () => {
            if (round === epoch.current) onPulse?.();
          },
          onDone: () => finishSpoken(round, 'pleased'),
          onError: () => finishSpoken(round, 'confused'),
        });
      };

      const onDelta = (delta: string) => {
        if (round !== epoch.current) return;
        openSpeech();
        // The answer is arriving: whatever gap a tool opened is over.
        speech.current?.hold(false);
        const r = pushText(sentences.current, delta);
        sentences.current = r.state;
        for (const sentence of r.sentences) {
          spoken.current = spoken.current ? `${spoken.current} ${sentence}` : sentence;
          speech.current?.push(sentence);
        }
      };

      /**
       * A tool is starting. Everything streamed so far was Eva's preamble —
       * "let me look that up" — so it gets flushed and spoken now rather than
       * waiting for a sentence boundary that may never come, and the stream is
       * held so the silence that follows isn't mistaken for a dead stream.
       */
      const onToolStart = (names: string[]) => {
        if (round !== epoch.current) return;
        if (speech.current) {
          const tail = flushPending(sentences.current);
          if (tail) {
            spoken.current = spoken.current ? `${spoken.current} ${tail}` : tail;
            speech.current.push(tail);
          }
          // A half-sentence left pending would otherwise be glued to the front
          // of the answer's first sentence when the tool returns.
          sentences.current = emptySentences();
          speech.current.hold(true);
          // The preamble was said aloud, so the transcript should show it —
          // but it is not part of the answer, and clearing it here is what
          // keeps it out of the reply line (and out of the failure line, which
          // reports whatever was actually spoken).
          if (spoken.current) onSaid?.(spoken.current);
          spoken.current = '';
        }
        // With no preamble spoken (the model skipped it), the aside machinery
        // is still armed and this is what makes its next line name the tool.
        if (names[0]) noteToolActivity(names[0]);
      };

      try {
        const result = await doAsk(text, { onDelta, onToolStart });
        if (round !== epoch.current) return; // cancelled or superseded mid-flight
        if (result.kind !== 'reply') {
          convWindow.current = decideNext('ask-failed', Date.now(), convWindow.current).window;
        }

        // Streaming path: the reply is already playing. Flush the tail, close
        // the stream, and let its drain callback settle the round.
        if (speech.current) {
          const tail = flushPending(sentences.current);
          if (tail) {
            spoken.current = spoken.current ? `${spoken.current} ${tail}` : tail;
            speech.current.push(tail);
          }
          // A failure after audio started is a transcript line, never a spoken
          // apology over the top of a half-delivered answer — but an open
          // stream no longer proves the answer started. A tool round clears
          // `spoken` at the tool boundary, so an empty one here means all Eva
          // said was a preamble promising an answer that never came, and
          // stopping there would be worse than apologizing.
          if (result.kind !== 'reply' && !spoken.current) {
            const line =
              result.kind === 'timeout'
                ? (result.message ?? TIMEOUT_LINE)
                : result.kind === 'offline'
                  ? (result.message ?? OFFLINE_LINE)
                  : FAILED_LINE;
            speech.current.hold(false);
            speech.current.push(line);
            spoken.current = line;
          }
          speech.current.end();
          speech.current = null;
          onSaid?.(result.kind === 'reply' ? result.speakable : spoken.current);
          if (result.kind === 'error') onIssue?.(result.message);
          return;
        }

        // Nothing streamed (Slack, or a transport that resolved without deltas).
        clearRoundSpeech();
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
            deliver(result.message ?? TIMEOUT_LINE, 'confused');
            break;
          case 'offline':
            deliver(result.message ?? OFFLINE_LINE, 'confused');
            break;
          case 'error':
            stopSpeaking(); // a lingering or queued aside must not talk over the confused face
            onIssue?.(result.message); // transports prefix their own source
            settle('confused', CONFUSED_BEAT_MS);
            break;
        }
      } catch {
        // A stream already playing owes this round a settle, and end() is what
        // makes its drain callback fire — on the system voice it is the only
        // thing that speaks at all. A rejecting handler must not strand it.
        if (round === epoch.current && speech.current) {
          speech.current.end();
          speech.current = null;
        }
      } finally {
        // Safety net: an ask handler that rejects instead of resolving would
        // otherwise leak the interval and narrate fillers forever. The round
        // guard preserves the invariant that a superseded round never clears a
        // newer round's state. An open stream is left alone — its drain callback
        // still owes this round a settle.
        if (round === epoch.current && !speech.current) clearRoundSpeech();
      }
    },
    [
      clearRoundSpeech,
      clearTimer,
      deliver,
      finishSpoken,
      noteToolActivity,
      onIssue,
      onPulse,
      onSaid,
      sayBack,
      setMode,
      settle,
      speakAside,
    ],
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
      clearRoundSpeech();
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

  /**
   * Eva speaking first: an alert beat to signal she's initiating rather than
   * answering, then the line itself. Delivered as a `pleased` round so the
   * follow-up mic opens after it — being addressed by Eva shouldn't force you
   * to say "Hey Eva" to answer her.
   */
  const announce = useCallback(
    (text: string) => {
      const round = ++epoch.current;
      clearRoundSpeech();
      voiceRound.current = true;
      convWindow.current = null;
      wokeAt.current = undefined;
      clearTimer();
      setMode('alert');
      after(ALERT_BEAT_MS, () => {
        // openMic bumps the epoch before its awaits but only clears the timer
        // after them, so this beat can still fire into a superseded round.
        if (round !== epoch.current) return;
        deliver(text, 'pleased');
      });
    },
    [after, clearRoundSpeech, clearTimer, deliver, setMode],
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
    clearRoundSpeech();
    active.current = false;
    convWindow.current = null;
    voiceRound.current = false;
    clearTimer();
    abortListening();
    stopSpeaking();
  }, [clearRoundSpeech, clearTimer]);

  return { listen, say, ask: askDirect, announce, cancel, noteToolActivity };
}
