import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { getTtsStatus, initKokoro, speakStreamWithKokoro, speakWithKokoro, stopKokoro } from './kokoro';

// v2: v1 wrongly persisted auto-picks; bumping the key discards those.
const VOICE_KEY = 'eva.voiceId.v2';

/**
 * One system voice is canonically Eva's fallback (the Kokoro engine, when
 * ready, speaks with its own baked-in voice). An explicitly chosen voice
 * (setVoice) is persisted and wins; otherwise re-rank on every call so that
 * downloading an Enhanced voice later (a one-time step in iOS Settings)
 * upgrades Eva automatically instead of being shadowed by an earlier auto-pick.
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
  /** Word-boundary events — system (AVSpeechSynthesizer) engine only; the Kokoro path never fires it. */
  onBoundary?: (charIndex: number) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

interface Utterance {
  id: number;
  text: string;
  cb: SpeakCallbacks;
  settled: boolean;
}

let seq = 0;
let active: Utterance | null = null;

const isCurrent = (u: Utterance) => active !== null && active.id === u.id;

/**
 * Terminate an utterance exactly once. Callers (useEcho) rely on every
 * utterance — including interrupted ones — reporting done or error a single
 * time; their epoch guard handles the rest.
 */
function settleUtterance(u: Utterance, fire: () => void): void {
  if (u.settled) return;
  u.settled = true;
  if (isCurrent(u)) active = null;
  fire();
}

function speakSystem(u: Utterance): Promise<void> {
  return resolveVoice()
    .then((voice) => {
      if (u.settled || !isCurrent(u)) return; // superseded while resolving the voice
      Speech.speak(u.text, {
        voice,
        language: 'en-US',
        onStart: () => {
          if (__DEV__) console.log('[tts] speaking (system):', u.text);
          if (isCurrent(u)) u.cb.onStart?.();
        },
        onBoundary: u.cb.onBoundary ? (ev: { charIndex: number }) => u.cb.onBoundary!(ev.charIndex) : undefined,
        onDone: () => settleUtterance(u, () => u.cb.onDone?.()),
        onStopped: () => settleUtterance(u, () => u.cb.onDone?.()),
        onError: (e) => settleUtterance(u, () => u.cb.onError?.(e)),
      });
    })
    .catch((e) => settleUtterance(u, () => u.cb.onError?.(e)));
}

export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
  stopSpeaking();
  const u: Utterance = { id: ++seq, text, cb, settled: false };
  active = u;
  const status = getTtsStatus();
  // A failed first-run download would otherwise demote the appliance to the
  // system voice until relaunch; retrying on each spoken reply gives a natural
  // backoff and picks Kokoro back up as soon as connectivity returns.
  if (status.state === 'error') void initKokoro();
  if (status.state === 'ready') {
    if (__DEV__) console.log('[tts] speaking (kokoro):', text);
    speakWithKokoro(text, {
      onStart: () => {
        if (isCurrent(u)) cb.onStart?.();
      },
      onDone: () => settleUtterance(u, () => cb.onDone?.()),
      onError: (e, audioStarted) => {
        if (u.settled) return;
        if (audioStarted) {
          settleUtterance(u, () => cb.onError?.(e));
          return;
        }
        // Nothing audible yet — retry the same utterance on the system voice.
        if (__DEV__) console.log('[tts] kokoro failed pre-audio, falling back:', e);
        void speakSystem(u);
      },
    });
    return;
  }
  await speakSystem(u);
}

export interface SpeechStream {
  /** Append text to speak. Safe to call repeatedly as a reply arrives. */
  push(text: string): void;
  /** No more text coming. */
  end(): void;
}

const speakOrSettle = (u: Utterance) => {
  // An empty utterance must still report done, or the round never settles.
  // Speech.speak('') is not documented to fire its callbacks.
  if (!u.text.trim()) {
    settleUtterance(u, () => u.cb.onDone?.());
    return;
  }
  void speakSystem(u);
};

/**
 * Speak text that is still arriving. Kokoro streams it as one continuous
 * utterance; the system voice, which has no streaming API, accumulates and
 * speaks the whole thing on end() — exactly today's behavior and latency.
 */
export function speakStream(cb: SpeakCallbacks = {}): SpeechStream {
  stopSpeaking();
  const u: Utterance = { id: ++seq, text: '', cb, settled: false };
  active = u;
  const status = getTtsStatus();
  // A failed first-run download would otherwise demote the appliance to the
  // system voice until relaunch; retrying here gives a natural backoff.
  if (status.state === 'error') void initKokoro();

  if (status.state !== 'ready') {
    let ended = false;
    return {
      push: (text) => {
        // trim(): callers may hand a leading/trailing space of their own (or
        // not, per useEcho's already-trimmed sentences) — either way the join
        // below is the single source of the separator, so it must not double up.
        if (!ended) {
          const t = text.trim();
          u.text = u.text ? `${u.text} ${t}` : t;
        }
      },
      end: () => {
        if (ended) return;
        ended = true;
        speakOrSettle(u);
      },
    };
  }

  if (__DEV__) console.log('[tts] streaming (kokoro)');
  let fellBack = false;
  let ended = false;
  const stream = speakStreamWithKokoro({
    onStart: () => {
      if (isCurrent(u)) cb.onStart?.();
    },
    onDone: () => settleUtterance(u, () => cb.onDone?.()),
    onError: (e, audioStarted) => {
      if (u.settled) return;
      if (audioStarted) {
        settleUtterance(u, () => cb.onError?.(e));
        return;
      }
      // Nothing audible yet — the system voice can still speak the whole
      // reply. u.text has been accumulating for exactly this case.
      if (__DEV__) console.log('[tts] kokoro failed pre-audio, falling back:', e);
      fellBack = true;
      if (ended) speakOrSettle(u);
    },
  });

  return {
    push: (text) => {
      if (ended) return;
      // See the other speakOrSettle-adjacent push() above: trim() so the join
      // below is the only place a separator gets added, regardless of what
      // whitespace the caller included.
      const t = text.trim();
      u.text = u.text ? `${u.text} ${t}` : t;
      if (!fellBack) stream.push(text);
    },
    end: () => {
      if (ended) return;
      ended = true;
      if (fellBack) speakOrSettle(u);
      else stream.end();
    },
  };
}

export function stopSpeaking(): void {
  const u = active;
  active = null;
  stopKokoro();
  Speech.stop();
  // The system engine reports its own stop via onStopped; settling here first
  // keeps one code path for both engines, and the settled flag dedupes.
  if (u) settleUtterance(u, () => u.cb.onDone?.());
}
