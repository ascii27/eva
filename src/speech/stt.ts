// On-device speech-to-text via expo-speech-recognition (SFSpeechRecognizer).
//
// The native module only exists in the EAS dev build — Expo Go lacks it — so
// it is required lazily and every entry point degrades to a readable error
// instead of crashing the face.
//
// Privacy invariant from the PRD: recognition must run on-device. We set
// requiresOnDeviceRecognition and refuse to start when the device doesn't
// support it — never silently fall back to Apple's servers.

export interface SttResult {
  transcript: string;
  /** 0..1, or -1 when the platform doesn't report confidence. */
  confidence: number;
  isFinal: boolean;
}

export interface SttEvents {
  onResult: (r: SttResult) => void;
  onError: (code: string, message: string) => void;
  onEnd: () => void;
}

type SttModule = typeof import('expo-speech-recognition');

let mod: SttModule | null | undefined;

function getStt(): SttModule | null {
  if (mod === undefined) {
    // Probe with the non-throwing API first: expo-speech-recognition calls
    // requireNativeModule() at module scope, which redboxes Expo Go even
    // inside try/catch when the native side is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo');
    if (!requireOptionalNativeModule('ExpoSpeechRecognition')) {
      mod = null;
      return mod;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-speech-recognition') as SttModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

export function sttAvailable(): boolean {
  return getStt() !== null;
}

/** Returns null when ready to listen, otherwise a human-readable blocker. */
export async function ensureReady(): Promise<string | null> {
  const stt = getStt();
  if (!stt) return 'Speech recognition needs the dev build (not available in Expo Go).';
  const m = stt.ExpoSpeechRecognitionModule;
  if (!m.isRecognitionAvailable()) return 'Speech recognition is not available on this device.';
  if (!m.supportsOnDeviceRecognition()) {
    return 'On-device recognition is not supported here — refusing to send audio to the network.';
  }
  const perm = await m.requestPermissionsAsync();
  if (!perm.granted) return 'Microphone / speech recognition permission was denied.';
  return null;
}

/** Subscribe to recognition events. Returns an unsubscribe function. */
export function addListeners(ev: SttEvents): () => void {
  const stt = getStt();
  if (!stt) return () => {};
  const m = stt.ExpoSpeechRecognitionModule;
  const subs = [
    m.addListener('result', (e) => {
      const best = e.results[0];
      if (best) ev.onResult({ transcript: best.transcript, confidence: best.confidence, isFinal: e.isFinal });
    }),
    m.addListener('error', (e) => {
      if (__DEV__) console.log(`[stt] error ${e.error} (native ${e.code ?? '?'}): ${e.message}`);
      ev.onError(e.error, e.message);
    }),
    m.addListener('end', () => {
      if (__DEV__) console.log('[stt] end');
      ev.onEnd();
    }),
  ];
  return () => subs.forEach((s) => s.remove());
}

export function startListening(): void {
  if (__DEV__) console.log('[stt] start');
  getStt()?.ExpoSpeechRecognitionModule.start({
    lang: 'en-US',
    interimResults: true,
    requiresOnDeviceRecognition: true,
    addsPunctuation: true,
    continuous: false,
    iosTaskHint: 'dictation',
    // The library's default session mode is 'measurement', which disables
    // system audio processing and is prone to activation interruptions right
    // after an AVSpeechSynthesizer (TTS) session winds down. 'default' is the
    // forgiving choice for a device that alternates speaking and listening.
    iosCategory: {
      category: 'playAndRecord',
      categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
      mode: 'default',
    },
  });
}

export function stopListening(): void {
  getStt()?.ExpoSpeechRecognitionModule.stop();
}

export function abortListening(): void {
  getStt()?.ExpoSpeechRecognitionModule.abort();
}
