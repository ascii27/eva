// Streaming PCM playback for the Kokoro engine, on react-native-audio-api.
//
// One long-lived AudioContext at Kokoro's native 24 kHz (no resampling, no
// per-utterance session teardown); each utterance gets an
// AudioBufferQueueSourceNode fed chunk-by-chunk as synthesis streams in.
//
// Loaded lazily from kokoro.ts only after the native availability probe —
// importing react-native-audio-api without its native module throws.
import { AudioContext, AudioManager } from 'react-native-audio-api';
import { tone, type ToneSpec } from './earcon';
import { drain, emptyJitter, offer, underrun, type JitterState } from './jitter';

const KOKORO_SAMPLE_RATE = 24000;

/**
 * How long to wait for the *first* chunk before declaring the synthesis dead.
 * Generous: a cold first synthesis is legitimately slow. The point is only that
 * this window is covered at all — without it, a generator that hangs before
 * yielding anything settles nothing, and the face never leaves 'thinking'.
 */
const FIRST_AUDIO_TIMEOUT_S = 20;

/**
 * Watchdog window while the caller has told us the silence is deliberate — a
 * tool is running and the rest of the reply has not been generated yet.
 * Deliberately longer than the ask's own 30s timeout (ASK_TIMEOUT_MS), so the
 * abort is always what ends a stuck round rather than the watchdog racing it.
 */
const HOLD_TIMEOUT_S = 35;

/**
 * Mirror stt.ts's audio session exactly (playAndRecord, defaultToSpeaker +
 * Bluetooth HFP, mode 'default'): with both engines asking for the same
 * configuration the session never churns between Eva speaking and listening —
 * the failure class the recognizer is documented to be sensitive to.
 */
export function configureAudioSession(): void {
  AudioManager.setAudioSessionOptions({
    iosCategory: 'playAndRecord',
    iosMode: 'default',
    iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
  });
}

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ sampleRate: KOKORO_SAMPLE_RATE });
  return ctx;
}

export interface UtteranceCallbacks {
  /** The first chunk is audible — the face's cue to enter 'speaking'. */
  onFirstAudio: () => void;
  /** All input chunks have been played to the end. */
  onDrained: () => void;
  /**
   * Whether sound is actually coming out right now.
   *
   * False while a lead is being built and whenever the queue has run dry with
   * more still to come — which is also exactly what a tool gap looks like from
   * here. The face reads this to still the mouth: `mode` stays 'speaking'
   * throughout, so without it the visemes flap through every synthesis gap and
   * through the whole of every tool call.
   */
  onFlowing?: (flowing: boolean) => void;
}

export interface UtteranceSink {
  enqueue: (chunk: Float32Array) => void;
  /** No more chunks are coming; onDrained fires once playback empties. */
  finishInput: () => void;
  /**
   * Silence from here is deliberate, not a stall — more audio is coming once
   * something slow (a tool call) finishes. Only the caller can tell the two
   * apart, which is the whole reason this exists.
   */
  hold: (on: boolean) => void;
  /** Immediate halt; no callback fires after this. */
  stop: () => void;
}

/**
 * Play one short generated cue — a wake acknowledgement — and return.
 *
 * A plain buffer source rather than the queue node an utterance uses: this is
 * fire-and-forget, nothing waits on it, and it must never interact with the
 * utterance lifecycle. It also deliberately does not stop anything already
 * playing; the cues only fire when the face is idle or about to listen.
 */
export function playCue(spec: ToneSpec): void {
  try {
    const context = getContext();
    if (context.state === 'suspended') void context.resume();
    const pcm = tone(spec, KOKORO_SAMPLE_RATE);
    if (pcm.length === 0) return;
    const buffer = context.createBuffer(1, pcm.length, KOKORO_SAMPLE_RATE);
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0, 0);
  } catch (e) {
    // A cue is a courtesy: losing one must never take a round down with it.
    // But a cue that silently never plays is indistinguishable from one that
    // was never wired up, so say so rather than swallowing it whole.
    if (__DEV__) console.log('[audioOut] cue failed:', e);
  }
}

export function beginUtterance(cb: UtteranceCallbacks): UtteranceSink {
  const context = getContext();
  // An audio-session interruption (phone call, Siri) can leave the long-lived
  // context suspended; kick it back to running before scheduling anything.
  if (context.state === 'suspended') void context.resume();
  const node = context.createBufferQueueSource();
  node.connect(context.destination);

  let pending = 0;
  let inputDone = false;
  let started = false;
  let finished = false;
  // Chunks deliberately held back to build a lead; see jitter.ts.
  let jitter: JitterState = emptyJitter();
  let flowing = false;
  const openedAt = Date.now();

  const setFlowing = (next: boolean) => {
    if (next === flowing || finished) return;
    flowing = next;
    cb.onFlowing?.(next);
  };

  // Every utterance must terminally report even if playback silently dies
  // (e.g. the context stays suspended after an interruption and bufferEnded
  // never fires) — otherwise the face wedges in 'speaking' and the wake
  // watcher stays suspended, deafening the appliance. The watchdog re-arms on
  // every playback event with the remaining scheduled audio plus slack.
  const chunkSeconds: number[] = [];
  let remainingSeconds = 0;
  // remainingSeconds only means anything once real audio has been scheduled
  // (enqueue maintains it incrementally from there); before that, this flag
  // routes the watchdog to the dedicated pre-audio window instead.
  let awaitingFirstAudio = true;
  // Set by hold(): suspends the "remaining audio plus slack" reasoning, which
  // would otherwise read a deliberate pause as a dead stream.
  let holding = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const rearmWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    if (finished) return;
    const seconds = holding
      ? HOLD_TIMEOUT_S
      : awaitingFirstAudio
        ? FIRST_AUDIO_TIMEOUT_S
        : // Audio held back to rebuild a lead is real audio that is about to
          // play, so it counts toward how long this may legitimately be quiet.
          remainingSeconds + jitter.heldSeconds + 5;
    watchdog = setTimeout(
      () => {
        if (__DEV__) console.log('[audioOut] watchdog: playback stalled, forcing done');
        finish(true);
      },
      seconds * 1000,
    );
  };

  const finish = (drained: boolean) => {
    if (finished) return;
    setFlowing(false);
    finished = true;
    if (watchdog) clearTimeout(watchdog);
    try {
      node.stop();
      node.clearBuffers();
      node.disconnect();
    } catch {
      // best-effort teardown of a node that may never have started
    }
    if (drained) cb.onDrained();
  };

  node.onBufferEnded = () => {
    pending -= 1;
    remainingSeconds -= chunkSeconds.shift() ?? 0;
    if (inputDone && pending <= 0) {
      finish(true);
      return;
    }
    if (pending <= 0) {
      // The queue emptied with more still coming: synthesis has fallen behind,
      // or a tool is running. Either way nothing is audible, and resuming on
      // the next single chunk would only starve again a moment later.
      if (__DEV__) console.log('[audioOut] underrun — rebuilding the lead');
      jitter = underrun(jitter);
      setFlowing(false);
    }
    rearmWatchdog();
  };

  /** Hand one chunk to the player. Everything upstream of this is held back. */
  const schedule = (chunk: Float32Array) => {
    awaitingFirstAudio = false;
    const buffer = context.createBuffer(1, chunk.length, KOKORO_SAMPLE_RATE);
    buffer.copyToChannel(chunk as Float32Array<ArrayBuffer>, 0);
    pending += 1;
    chunkSeconds.push(buffer.duration);
    remainingSeconds += buffer.duration;
    node.enqueueBuffer(buffer);
    if (!started) {
      started = true;
      // What the lead actually cost, so PREBUFFER_SECONDS can be tuned against
      // the device rather than guessed at. This is the delay it adds to the
      // first word — the price paid for not stuttering through the rest.
      if (__DEV__) console.log(`[audioOut] lead built in ${Date.now() - openedAt}ms`);
      // Explicit (when, offset): the library's bare start() defaults offset
      // to -1 and then rejects it (react-native-audio-api 0.13.2 bug).
      node.start(0, 0);
      cb.onFirstAudio();
    }
    setFlowing(true);
  };

  // Cover the pre-playback window too: every other rearm site needs a chunk or a
  // finishInput to have happened first.
  rearmWatchdog();

  return {
    enqueue: (chunk) => {
      if (finished || chunk.length === 0) return;
      const r = offer(jitter, chunk, chunk.length / KOKORO_SAMPLE_RATE);
      jitter = r.state;
      for (const ready of r.flush) schedule(ready);
      rearmWatchdog();
    },
    finishInput: () => {
      // Whatever is still held plays now, however short of a lead it is: a
      // two-word reply must not wait for audio that is never coming.
      const r = drain(jitter);
      jitter = r.state;
      for (const ready of r.flush) schedule(ready);
      inputDone = true;
      // Nothing more is coming, so nothing is being waited for: a hold left
      // standing here would only stretch the stall window for no reason.
      holding = false;
      // A zero-audio utterance still reports drained so the caller settles.
      if (pending <= 0) finish(true);
      else rearmWatchdog();
    },
    hold: (on) => {
      if (finished) return;
      holding = on;
      rearmWatchdog();
    },
    stop: () => finish(false),
  };
}
