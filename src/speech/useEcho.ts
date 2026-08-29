import { useCallback, useEffect, useRef } from 'react';
import type { FaceMode } from '../face/types';
import { type AskOptions, type AskResult, formatLatency } from '../round/ask';
import { emptySentences, flushPending, pushText, type SentenceState } from '../round/sentences';
import { beginAside, decideAside, noteTool, type AsideState } from './asides';
import { type ConvWindow, decideNext } from './conversation';
import { abortListening, addListeners, ensureReady, startListening } from './stt';
import { speak, speakStream, stopSpeaking, type SpeechStream } from './tts';
import { CONSENT_QUESTION, CONSENT_RETRY, readConsent, type Consent } from '../vision/consent';

const THINK_BEAT_MS = 300;
const ALERT_BEAT_MS = 600;
const PLEASED_BEAT_MS = 600;
const CONFUSED_BEAT_MS = 1200;
const LOW_CONFIDENCE = 0.35;

/**
 * How long Eva waits to be told yes or no before giving up on a consent gate.
 * Generous — she has just asked a question and someone has to look up from
 * what they were doing — but bounded, because the round behind it is holding a
 * tool open and the appliance is deaf until it settles.
 */
const CONSENT_TIMEOUT_MS = 15_000;

/**
 * Longest the gate waits for a preamble to finish playing before opening the
 * mic anyway. Generous — MAX_REPLY_TOKENS bounds a preamble to a sentence, so
 * reaching this means the speech engine stopped reporting rather than that Eva
 * is still talking.
 */
const DRAIN_TIMEOUT_MS = 10_000;

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
  /**
   * One-shot redirect for the open stream's drain. Set by the consent gate,
   * which ends the stream mid-round to free the audio session for the mic:
   * without it, `end()` would drain into finishSpoken and settle a round that
   * is still waiting on an answer — and open the follow-up mic on top of the
   * consent one.
   */
  const drain = useRef<(() => void) | null>(null);
  /**
   * Non-null while Eva is waiting to be told yes or no. The mount-once STT
   * listeners check it *before* the normal routing, because otherwise "yeah go
   * ahead" would be treated as a new question and start a round that kills the
   * one waiting on it.
   */
  const consent = useRef<{ finish: (answer: Consent) => void } | null>(null);
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
    // Release rather than drop: the consent gate may be parked on this,
    // waiting for the question to finish playing. Dropping it strands the gate,
    // which strands the tool call behind it — and by then the ask timeout has
    // been suspended for the gate, so nothing else would ever settle the round.
    // The woken gate re-checks the epoch and bails.
    const redirect = drain.current;
    drain.current = null;
    redirect?.();
    sentences.current = emptySentences();
    spoken.current = '';
  }, []);

  /**
   * Settle any open consent gate as a refusal. Abandoning the round is not a
   * reason to leave the promise hanging — the tool loop behind it would block
   * until the ask timeout fired, with the face stuck mid-round.
   */
  const closeConsent = useCallback(() => {
    consent.current?.finish('unclear');
    consent.current = null;
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

  /**
   * Bring the recognizer up for a round that already exists.
   *
   * Split out of openMic because the consent gate must open the mic *inside*
   * the round it is gating — claiming a new epoch there would supersede the
   * very ask that is waiting on the answer. `blocker: null` means the round
   * moved on underneath us and the caller should simply stop.
   */
  const startMic = useCallback(
    async (round: number): Promise<{ ok: true } | { ok: false; blocker: string | null }> => {
      const blocker = await ensureReady();
      if (round !== epoch.current) return { ok: false, blocker: null };
      if (blocker) return { ok: false, blocker };
      // Give the TTS audio session time to fully deactivate — starting the
      // recognizer mid-teardown surfaces as an "interrupted" error on iOS.
      stopSpeaking();
      await new Promise((r) => setTimeout(r, 300));
      if (round !== epoch.current) return { ok: false, blocker: null };
      transcript.current = '';
      confidence.current = -1;
      active.current = true;
      clearTimer();
      setMode('listening');
      startListening();
      return { ok: true };
    },
    [clearTimer, setMode],
  );

  /** Open the mic for one command session; wokeAtMs stamps wake-to-audio latency. */
  const openMic = useCallback(
    async (wokeAtMs?: number) => {
      const round = ++epoch.current;
      clearRoundSpeech();
      wokeAt.current = wokeAtMs;
      const started = await startMic(round);
      if (started.ok || started.blocker === null) return;
      convWindow.current = null;
      onIssue?.(started.blocker);
      settle('confused', CONFUSED_BEAT_MS);
    },
    [clearRoundSpeech, onIssue, settle, startMic],
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

  /** Speak one line and resolve once it has actually finished playing. */
  const sayAndWait = useCallback(
    (round: number, line: string) =>
      new Promise<void>((resolve) => {
        onSaid?.(line);
        speak(line, {
          onStart: () => {
            if (round === epoch.current) setMode('speaking');
          },
          onBoundary: () => {
            if (round === epoch.current) onPulse?.();
          },
          onDone: () => resolve(),
          onError: () => resolve(),
        });
      }),
    [onPulse, onSaid, setMode],
  );

  /** One listen whose result goes to the gate instead of becoming a question. */
  const listenForAnswer = useCallback(
    (round: number) =>
      new Promise<Consent>((resolve) => {
        let settled = false;
        const finish = (answer: Consent) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          consent.current = null;
          resolve(answer);
        };
        const timeout = setTimeout(() => {
          // Nobody answered. Silence is never consent.
          abortListening();
          finish('unclear');
        }, CONSENT_TIMEOUT_MS);
        // Armed before the mic comes up: startMic is async and a fast
        // recognizer could otherwise end before anything is listening.
        consent.current = { finish };
        void startMic(round).then((started) => {
          if (!started.ok) {
            if (started.blocker) onIssue?.(started.blocker);
            finish('unclear');
          }
        });
      }),
    [onIssue, startMic],
  );

  /**
   * Ask the room for permission and wait. Resolves true only on an audible
   * yes — every other outcome, including a superseded round, a mic that would
   * not open, and nobody saying anything at all, is a no.
   *
   * An open stream is *ended* rather than held: `startMic` calls
   * `stopSpeaking()`, which would kill a Kokoro stream anyway, and the
   * question has to finish playing before the mic opens or Eva talks over her
   * own request. The answer arrives on a fresh stream afterwards, because
   * `openSpeech` opens one on the next delta.
   *
   * Takes the round rather than claiming one: a gate inside an ask must stay
   * in the round it is gating, or it would supersede the very request waiting
   * on the answer.
   */
  const askForConsent = useCallback(
    async (round: number): Promise<boolean> => {
      if (round !== epoch.current) return false;

      // An aside firing into the gate would talk over the question or the
      // answer. With no preamble spoken, the aside timer is still armed here.
      if (asideTimer.current) clearInterval(asideTimer.current);
      asideTimer.current = null;
      asideState.current = null;

      if (speech.current) {
        // The preamble already asked. Flush its tail, then let it drain.
        const tail = flushPending(sentences.current);
        if (tail) {
          spoken.current = spoken.current ? `${spoken.current} ${tail}` : tail;
          speech.current.push(tail);
        }
        sentences.current = emptySentences();
        if (spoken.current) onSaid?.(spoken.current);
        spoken.current = '';
        const open = speech.current;
        speech.current = null;
        await new Promise<void>((resolve) => {
          let settled = false;
          const once = () => {
            if (settled) return;
            settled = true;
            clearTimeout(bound);
            drain.current = null;
            resolve();
          };
          // A speech engine that never reports done would otherwise park the
          // gate here for good, holding a tool call open behind it.
          const bound = setTimeout(once, DRAIN_TIMEOUT_MS);
          drain.current = once;
          open.hold(false);
          open.end();
        });
      } else {
        // Nothing has been asked yet — the model skipped its preamble, or
        // there is no model in this round at all (the overlay's Look button).
        await sayAndWait(round, CONSENT_QUESTION);
      }
      if (round !== epoch.current) return false;

      let answer = await listenForAnswer(round);
      if (answer === 'unclear' && round === epoch.current) {
        await sayAndWait(round, CONSENT_RETRY);
        if (round !== epoch.current) return false;
        answer = await listenForAnswer(round);
      }
      if (round !== epoch.current) return false;

      // Back to waiting, whichever way it went.
      setMode('thinking');
      onIssue?.(`vision · ${answer === 'yes' ? 'allowed' : 'declined'}`);
      return answer === 'yes';
    },
    [listenForAnswer, onIssue, onSaid, sayAndWait, setMode],
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
          // The consent gate ends this stream itself and needs to know when
          // the audio has actually stopped — settling the round here instead
          // would strand the tool call waiting behind it.
          onDone: () => {
            const redirect = drain.current;
            if (redirect) {
              drain.current = null;
              redirect();
              return;
            }
            finishSpoken(round, 'pleased');
          },
          onError: () => {
            const redirect = drain.current;
            if (redirect) {
              drain.current = null;
              redirect();
              return;
            }
            finishSpoken(round, 'confused');
          },
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
        if (__DEV__) {
          // Whether a stream is open here is exactly whether the model obeyed
          // the preamble rule — the one thing about this that cannot be
          // checked off the device.
          console.log(
            `[echo] tool gap: ${names.join(', ')} — ${speech.current ? 'holding the stream' : 'NO PREAMBLE, asides cover it'}`,
          );
        }
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
        const result = await doAsk(text, { onDelta, onToolStart, onConsent: () => askForConsent(round) });
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
      askForConsent,
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
        // A gate is waiting on this session, and a recognizer that failed told
        // us nothing — which is not a yes.
        const gate = consent.current;
        if (gate) {
          if (code !== 'aborted' && code !== 'no-speech') onIssue?.(`STT ${code}: ${message}`);
          gate.finish('unclear');
          return;
        }
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
        // Routed to the gate before anything else: undiverted, "yeah go ahead"
        // becomes a new question and kills the round waiting on the answer.
        const gate = consent.current;
        if (gate) {
          if (text) onHeard?.(text);
          gate.finish(!text || lowConf ? 'unclear' : readConsent(text));
          return;
        }
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
      closeConsent();
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

  /**
   * Run the consent gate on its own, with no model in the loop, and hand the
   * answer to `onAllowed`.
   *
   * This is the overlay's Look button. It exists because every other route to
   * the gate depends on the model choosing to reach for the camera, and "she
   * didn't take a photo" looks identical whether the gate is broken or she
   * simply never called the tool.
   */
  const look = useCallback(
    async (onAllowed: () => Promise<void>): Promise<void> => {
      const round = ++epoch.current;
      closeConsent();
      clearRoundSpeech();
      voiceRound.current = false;
      convWindow.current = null;
      clearTimer();
      setMode('thinking');
      const allowed = await askForConsent(round);
      if (round !== epoch.current) return;
      if (allowed) await onAllowed();
      if (round !== epoch.current) return;
      settle(allowed ? 'pleased' : 'confused', allowed ? PLEASED_BEAT_MS : CONFUSED_BEAT_MS);
    },
    [askForConsent, clearRoundSpeech, clearTimer, closeConsent, setMode, settle],
  );

  /** Abandon any in-flight listen/ask/speak and return control to the caller. */
  const cancel = useCallback(() => {
    epoch.current++;
    closeConsent();
    clearRoundSpeech();
    active.current = false;
    convWindow.current = null;
    voiceRound.current = false;
    clearTimer();
    abortListening();
    stopSpeaking();
  }, [clearRoundSpeech, clearTimer, closeConsent]);

  return { listen, say, ask: askDirect, announce, cancel, noteToolActivity, look };
}
