// Streaming PCM playback for the Kokoro engine, on react-native-audio-api.
//
// One long-lived AudioContext at Kokoro's native 24 kHz (no resampling, no
// per-utterance session teardown); each utterance gets an
// AudioBufferQueueSourceNode fed chunk-by-chunk as synthesis streams in.
//
// Loaded lazily from kokoro.ts only after the native availability probe —
// importing react-native-audio-api without its native module throws.
import { AudioContext, AudioManager } from 'react-native-audio-api';

const KOKORO_SAMPLE_RATE = 24000;

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
}

export interface UtteranceSink {
  enqueue: (chunk: Float32Array) => void;
  /** No more chunks are coming; onDrained fires once playback empties. */
  finishInput: () => void;
  /** Immediate halt; no callback fires after this. */
  stop: () => void;
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

  // Every utterance must terminally report even if playback silently dies
  // (e.g. the context stays suspended after an interruption and bufferEnded
  // never fires) — otherwise the face wedges in 'speaking' and the wake
  // watcher stays suspended, deafening the appliance. The watchdog re-arms on
  // every playback event with the remaining scheduled audio plus slack.
  const chunkSeconds: number[] = [];
  let remainingSeconds = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const rearmWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    if (finished) return;
    watchdog = setTimeout(
      () => {
        if (__DEV__) console.log('[audioOut] watchdog: playback stalled, forcing done');
        finish(true);
      },
      (remainingSeconds + 5) * 1000,
    );
  };

  const finish = (drained: boolean) => {
    if (finished) return;
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
    rearmWatchdog();
  };

  return {
    enqueue: (chunk) => {
      if (finished || chunk.length === 0) return;
      const buffer = context.createBuffer(1, chunk.length, KOKORO_SAMPLE_RATE);
      buffer.copyToChannel(chunk as Float32Array<ArrayBuffer>, 0);
      pending += 1;
      chunkSeconds.push(buffer.duration);
      remainingSeconds += buffer.duration;
      node.enqueueBuffer(buffer);
      rearmWatchdog();
      if (!started) {
        started = true;
        // Explicit (when, offset): the library's bare start() defaults offset
        // to -1 and then rejects it (react-native-audio-api 0.13.2 bug).
        node.start(0, 0);
        cb.onFirstAudio();
      }
    },
    finishInput: () => {
      inputDone = true;
      // A zero-audio utterance still reports drained so the caller settles.
      if (pending <= 0) finish(true);
      else rearmWatchdog();
    },
    stop: () => finish(false),
  };
}
