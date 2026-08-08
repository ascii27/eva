// On-device neural TTS: Kokoro-82M running in ExecuTorch
// (react-native-executorch), streamed into react-native-audio-api.
//
// The native runtimes exist only in the EAS dev build — Expo Go lacks them —
// so both libraries hide behind a TurboModule probe and lazy require()s
// (each runs native install code at import time and would redbox Expo Go).
// The tts facade routes to the system voice whenever this engine isn't
// 'ready', so the face keeps speaking everywhere.
//
// Model + phonemizer + voice (~330 MB) download once on first run via the
// Expo resource fetcher and are cached in the app's documents directory.

import type { TextToSpeechModule } from 'react-native-executorch';
import type { UtteranceSink } from './audioOut';

export type TtsEngineState =
  | { state: 'unavailable' }
  | { state: 'downloading'; progress: number }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; error: unknown };

export interface KokoroSpeakHandlers {
  /** First audio actually audible — the face's cue to enter 'speaking'. */
  onStart: () => void;
  /** Playback fully drained. */
  onDone: () => void;
  /** audioStarted=false means nothing played yet and the caller may retry on another engine. */
  onError: (error: unknown, audioStarted: boolean) => void;
}

export type TtsStatusListener = (status: TtsEngineState) => void;

let status: TtsEngineState = { state: 'unavailable' };
let listener: TtsStatusListener | undefined;
let engine: TextToSpeechModule | null = null;
let initInFlight = false;

function setStatus(next: TtsEngineState): void {
  status = next;
  // Console breadcrumbs (sans per-chunk download spam) so the engine can be
  // watched over `simctl`/Metro logs, not just the on-screen transcript.
  if (__DEV__ && next.state !== 'downloading') {
    console.log(`[kokoro] ${next.state}${next.state === 'error' ? `: ${String(next.error)}` : ''}`);
  }
  listener?.(next);
}

export function getTtsStatus(): TtsEngineState {
  return status;
}

function nativeTtsAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TurboModuleRegistry } = require('react-native');
  return TurboModuleRegistry.get('ETInstaller') != null && TurboModuleRegistry.get('AudioAPIModule') != null;
}

/**
 * Download (first run only), load, and stand up the Kokoro engine. Idempotent
 * while in flight or ready; calling again after an error retries.
 */
export async function initKokoro(onStatus?: TtsStatusListener): Promise<void> {
  if (onStatus) listener = onStatus;
  if (initInFlight || status.state === 'ready') return;
  if (!nativeTtsAvailable()) {
    setStatus({ state: 'unavailable' });
    return;
  }
  initInFlight = true;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const executorch = require('react-native-executorch') as typeof import('react-native-executorch');
    const fetcher =
      require('react-native-executorch-expo-resource-fetcher') as typeof import('react-native-executorch-expo-resource-fetcher');
    const { EVA_TTS_CONFIG } = require('./kokoroConfig') as typeof import('./kokoroConfig');
    const audioOut = require('./audioOut') as typeof import('./audioOut');
    /* eslint-enable @typescript-eslint/no-require-imports */
    executorch.initExecutorch({ resourceFetcher: fetcher.ExpoResourceFetcher });
    audioOut.configureAudioSession();
    setStatus({ state: 'downloading', progress: 0 });
    engine = await executorch.TextToSpeechModule.fromModelName(EVA_TTS_CONFIG, (progress) => {
      if (progress >= 1) setStatus({ state: 'loading' });
      else if (status.state === 'downloading') setStatus({ state: 'downloading', progress });
    });
    setStatus({ state: 'ready' });
  } catch (error) {
    engine = null;
    setStatus({ state: 'error', error });
  } finally {
    initInFlight = false;
  }
}

interface ActiveSpeech {
  stopped: boolean;
  audioStarted: boolean;
  sink: UtteranceSink | null;
}

let current: ActiveSpeech | null = null;
/** Streams share one native engine; each new one waits for the previous to wind down. */
let streamTail: Promise<void> = Promise.resolve();

export function speakWithKokoro(text: string, handlers: KokoroSpeakHandlers): void {
  const e = engine;
  if (!e || status.state !== 'ready') {
    handlers.onError(new Error('kokoro engine is not ready'), false);
    return;
  }
  if (!text.trim()) {
    handlers.onDone();
    return;
  }
  const s: ActiveSpeech = { stopped: false, audioStarted: false, sink: null };
  current = s;
  const prev = streamTail;
  streamTail = (async () => {
    // A barge-in stops the previous stream via streamStop(true), but the
    // native side lands that asynchronously — starting the next stream in the
    // same tick can get it killed or corrupted. Wait for the previous
    // generator to actually exit, but never indefinitely: a hung stream must
    // not take future utterances down with it.
    await Promise.race([prev, new Promise((r) => setTimeout(r, 2000))]);
    if (s.stopped) return;
    await runStream(e, text.trim(), s, handlers);
  })();
}

async function runStream(
  e: TextToSpeechModule,
  text: string,
  s: ActiveSpeech,
  handlers: KokoroSpeakHandlers,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const audioOut = require('./audioOut') as typeof import('./audioOut');
  try {
    s.sink = audioOut.beginUtterance({
      onFirstAudio: () => {
        if (s.stopped) return;
        s.audioStarted = true;
        handlers.onStart();
      },
      onDrained: () => {
        if (s.stopped) return;
        s.stopped = true;
        if (current === s) current = null;
        handlers.onDone();
      },
    });
    // Kokoro partitions the stream on terminal punctuation; an unterminated
    // tail would never flush (same guard as the library's own hook).
    e.streamInsert('.?!;'.includes(text.slice(-1)) ? text : `${text}.`);
    for await (const chunk of e.stream({ speed: 1.0, phonemize: true, stopAutomatically: true })) {
      if (s.stopped) return;
      s.sink.enqueue(chunk);
    }
    if (!s.stopped) s.sink.finishInput();
  } catch (error) {
    if (s.stopped) return;
    s.stopped = true;
    if (current === s) current = null;
    try {
      // An audio-side throw leaves the native stream running; without this the
      // next utterance's streamInsert lands on the abandoned stream.
      e.streamStop(true);
    } catch {
      // stopping an idle stream is harmless
    }
    s.sink?.stop();
    handlers.onError(error, s.audioStarted);
  }
}

/** Halt synthesis and playback. Silent: no handler fires after this returns. */
export function stopKokoro(): void {
  const s = current;
  current = null;
  if (!s || s.stopped) return;
  s.stopped = true;
  try {
    engine?.streamStop(true);
  } catch {
    // stopping an idle stream is harmless
  }
  s.sink?.stop();
}
