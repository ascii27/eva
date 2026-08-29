// The two small sounds Eva makes when she wakes — generated, not recorded.
//
// Pure PCM maths, no I/O: audioOut plays the samples through the AudioContext
// it already owns. Synthesizing them here rather than shipping audio files is
// the cheaper choice in every direction — no asset in the bundle, no loader,
// no decoding, and above all no new native module, which would mean an EAS
// rebuild on the one phone this runs on.
//
// Both cues are enveloped with a raised cosine over the whole tone. A blip cut
// off square starts and ends on a non-zero sample, and that step is audible as
// a click on a small speaker — which would be a worse artifact than the
// silence these are meant to fill.

export interface ToneSpec {
  freq: number;
  /** Glide to this by the end, for a cue that rises rather than sits still. */
  toFreq?: number;
  ms: number;
  /** Peak amplitude. These play close to a microphone that is about to open. */
  gain: number;
}

/**
 * "I heard you", the instant the wake word matches. Low and soft: it is an
 * acknowledgement, not an announcement, and it lands while the recognizer is
 * still being torn down and restarted.
 */
export const HEARD: ToneSpec = { freq: 440, ms: 90, gain: 0.16 };

/**
 * "Go ahead" — the recognizer is actually listening. Brighter, and rising, so
 * the pair reads as a question being opened rather than two identical beeps.
 */
export const LIVE: ToneSpec = { freq: 660, toFreq: 880, ms: 120, gain: 0.2 };

/**
 * Render one cue as mono PCM at `sampleRate`.
 *
 * The frequency glide is integrated as a running phase rather than computed as
 * `sin(2π f(t) t)`: sampling a moving frequency at absolute time makes the
 * phase jump between samples, which buzzes. Accumulating the phase keeps the
 * waveform continuous however fast the pitch moves.
 */
export function tone(spec: ToneSpec, sampleRate: number): Float32Array {
  const length = Math.round((spec.ms / 1000) * sampleRate);
  const pcm = new Float32Array(Math.max(0, length));
  if (pcm.length === 0) return pcm;

  const from = spec.freq;
  const to = spec.toFreq ?? spec.freq;
  let phase = 0;
  for (let i = 0; i < pcm.length; i++) {
    // Guard the single-sample case: there is no span to interpolate across.
    const progress = pcm.length > 1 ? i / (pcm.length - 1) : 0;
    const freq = from + (to - from) * progress;
    // Raised cosine, zero at both ends and 1 in the middle.
    const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * progress));
    pcm[i] = Math.sin(phase) * envelope * spec.gain;
    phase += (2 * Math.PI * freq) / sampleRate;
  }
  return pcm;
}
