import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

// v2: v1 wrongly persisted auto-picks; bumping the key discards those.
const VOICE_KEY = 'eva.voiceId.v2';

/**
 * One system voice is canonically Eva's. An explicitly chosen voice (setVoice)
 * is persisted and wins; otherwise re-rank on every call so that downloading
 * an Enhanced voice later (a one-time step in iOS Settings) upgrades Eva
 * automatically instead of being shadowed by an earlier auto-pick.
 */
export async function resolveVoice(): Promise<string | undefined> {
  const voices = await Speech.getAvailableVoicesAsync();
  const stored = await AsyncStorage.getItem(VOICE_KEY);
  if (stored && voices.some((v) => v.identifier === stored)) return stored;
  // Preference: Enhanced first, then real (non-novelty) voices, then en-US.
  // Novelty voices (Trinoids, Zarvox, …) ship on every iPhone under the legacy
  // synthesis bundle and report Default quality like real voices do.
  const novelty = (v: Speech.Voice) => v.identifier?.startsWith('com.apple.speech.synthesis.voice');
  const english = voices
    .filter((v) => v.language?.startsWith('en'))
    .sort((a, b) => {
      const rank = (v: Speech.Voice) =>
        (v.quality === Speech.VoiceQuality.Enhanced ? 0 : 4) + (novelty(v) ? 2 : 0) + (v.language === 'en-US' ? 0 : 1);
      return rank(a) - rank(b);
    });
  const pick = english[0];
  if (__DEV__) {
    console.log(
      `[tts] ${voices.length} voices, ${english.length} english; picked ${pick?.name ?? 'system default'} (${pick?.quality ?? '?'})`,
    );
  }
  return pick?.identifier;
}

export async function setVoice(identifier: string): Promise<void> {
  await AsyncStorage.setItem(VOICE_KEY, identifier);
}

export interface SpeakCallbacks {
  onStart?: () => void;
  /** Word-boundary events from AVSpeechSynthesizer — real timing for the face. */
  onBoundary?: (charIndex: number) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
  const voice = await resolveVoice();
  Speech.stop();
  Speech.speak(text, {
    voice,
    language: 'en-US',
    onStart: () => {
      if (__DEV__) console.log('[tts] speaking:', text);
      cb.onStart?.();
    },
    onBoundary: cb.onBoundary ? (ev: { charIndex: number }) => cb.onBoundary!(ev.charIndex) : undefined,
    onDone: () => {
      if (__DEV__) console.log('[tts] done');
      cb.onDone?.();
    },
    onError: (e) => {
      if (__DEV__) console.log('[tts] error:', e);
      cb.onError?.(e);
    },
    onStopped: cb.onDone,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
