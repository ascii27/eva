import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

const VOICE_KEY = 'eva.voiceId';

/**
 * One system voice is canonically Eva's. Prefer the persisted pick; otherwise
 * the first Enhanced-quality English voice on the device (Enhanced voices are
 * a one-time download in iOS Settings — a device setup step, not an app one).
 */
export async function resolveVoice(): Promise<string | undefined> {
  const voices = await Speech.getAvailableVoicesAsync();
  const stored = await AsyncStorage.getItem(VOICE_KEY);
  if (stored && voices.some((v) => v.identifier === stored)) return stored;
  const english = voices.filter((v) => v.language?.startsWith('en'));
  const pick = english.find((v) => v.quality === Speech.VoiceQuality.Enhanced) ?? english[0];
  if (pick) await AsyncStorage.setItem(VOICE_KEY, pick.identifier);
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
    onStart: cb.onStart,
    onBoundary: cb.onBoundary ? (ev: { charIndex: number }) => cb.onBoundary!(ev.charIndex) : undefined,
    onDone: cb.onDone,
    onError: cb.onError,
    onStopped: cb.onDone,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
