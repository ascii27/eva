// Audio-driven lip sync (ASC-53).
//
// Kokoro streams PCM and nothing else: no phonemes, no timings. The mouth used
// to loop a canned 26-frame sequence for as long as she was speaking, so it had
// no relation to the words — open during a pause, shut on a long "ah". The one
// thing that does carry the words is the audio itself, so the mouth now reads
// that: each LIPSYNC_FRAME_MS slice of the chunk about to play is classified
// into one of the design's 13 visemes from three cheap features.
//
//   level     RMS against the loudest frame heard so far this utterance, so a
//             quiet voice and a loud one open the mouth the same amount.
//   zcr       zero-crossing rate. Hiss (s, z, f, sh) crosses zero constantly;
//             voiced sound does not.
//   centroid  a brightness estimate in Hz: the RMS of the first difference over
//             the RMS of the signal is 2·sin(πf/fs) for a sinusoid, so inverting
//             it gives the frequency the energy sits at. Rounded vowels (oo, oh)
//             are dark, open ones (ah) mid, spread ones (ee, i) bright.
//
// This is not phoneme recognition and does not pretend to be: what it gets
// exactly right is *timing* — closed in every gap, open on every syllable, teeth
// on every hiss — which is most of what makes a mouth read as saying the words.
// The vowel shape is a good guess. Thresholds were set against real speech
// (macOS `say` rendered at Kokoro's 24 kHz); see the tests for the contract.
//
// Pure, no React: the analyser runs in audioOut as each chunk is scheduled.

import type { VisemeKey } from './visemes';

/**
 * One analysis frame. Not from the design file — the design's 112ms clock is a
 * canned loop with nothing to follow. A phoneme lasts ~60–120ms, so ~50ms is the
 * coarsest frame that still lands a short consonant inside its own frame.
 */
export const LIPSYNC_FRAME_MS = 50;

export interface FrameFeatures {
  rms: number;
  /** Zero crossings per sample, 0..1. */
  zcr: number;
  /** Where the energy sits, Hz. */
  centroid: number;
  /**
   * The same estimate on the first difference — a pre-emphasised signal, where
   * the second formant outweighs the first. Spread vowels (ee, i) have a high
   * F2 and rounded ones (oo, oh) a low one, which the plain centroid, dominated
   * by the voice's fundamental, cannot see.
   */
  bright: number;
}

export function frameFeatures(pcm: Float32Array, start: number, end: number, sampleRate: number): FrameFeatures {
  let sum = 0;
  let diff = 0;
  let diff2 = 0;
  let crossings = 0;
  let prev = pcm[start] ?? 0;
  let prevD = 0;
  for (let i = start; i < end; i++) {
    const x = pcm[i];
    sum += x * x;
    if (i > start) {
      const d = x - prev;
      diff += d * d;
      if (i > start + 1) diff2 += (d - prevD) * (d - prevD);
      prevD = d;
      if ((x >= 0) !== (prev >= 0)) crossings++;
    }
    prev = x;
  }
  const n = Math.max(1, end - start);
  const rms = Math.sqrt(sum / n);
  if (sum === 0) return { rms: 0, zcr: 0, centroid: 0, bright: 0 };
  return {
    rms,
    zcr: crossings / n,
    centroid: toHz(diff / sum, sampleRate),
    bright: diff === 0 ? 0 : toHz(diff2 / diff, sampleRate),
  };
}

/** A sinusoid at f has diff-RMS/RMS = 2·sin(πf/fs); invert it. */
function toHz(powerRatio: number, sampleRate: number): number {
  const r = Math.min(2, Math.sqrt(powerRatio));
  return (sampleRate / Math.PI) * Math.asin(r / 2);
}

/** Below this fraction of the utterance's peak the mouth is shut. */
const SILENT = 0.07;
/** Absolute floor, so the first quiet frames of an utterance don't set the peak. */
const MIN_PEAK = 0.02;
/** Voiced but faint: a nasal or the closure-release of a stop. */
const MURMUR = 0.2;
/** Hiss: crossing zero on more than this fraction of samples. */
const FRICATIVE_ZCR = 0.22;
const FRICATIVE_CENTROID = 2600;

export function classifyFrame(f: FrameFeatures, peak: number): VisemeKey {
  const level = f.rms / Math.max(peak, MIN_PEAK);
  if (level < SILENT) return 'sil';
  if (f.zcr > FRICATIVE_ZCR || f.centroid > FRICATIVE_CENTROID) {
    // s/z/t hiss highest; f/v are a quiet, lower hiss; what is left is the
    // breathy seam between a hiss and the vowel after it.
    if (f.centroid > 3400) return 'DT';
    if (level < 0.25) return 'FV';
    return 'TH';
  }
  if (level < MURMUR) {
    // m/b/p hum low behind closed lips; n/l/k a little brighter.
    if (f.centroid < 450) return 'MBP';
    return f.centroid < 1100 ? 'L' : 'K';
  }
  // Measured on 24 kHz speech (centroid / bright, Hz):
  //   ee  ~500 / 2700-2900     ah  ~900 / 1400-1550     oh  ~500 / 800-1400
  //   oo  ~350 / 2000-2300 (American oo is fronted)     e, a  ~800 / 1550-1800
  if (f.bright >= 2600) return 'EE';
  if (f.centroid >= 850) return level > 0.75 ? 'AH' : 'AA';
  if (f.centroid >= 680) return 'AA';
  if (f.bright >= 2000) return f.centroid < 500 ? 'OO' : 'IH';
  if (f.bright < 1500) return 'OH';
  return f.centroid < 480 ? 'OO' : 'OH';
}

export interface LipSync {
  /** Visemes for this chunk, one per LIPSYNC_FRAME_MS, in playback order. */
  analyze(pcm: Float32Array): VisemeKey[];
}

/**
 * One analyser per utterance. It carries the running peak across chunks — a
 * chunk that is one quiet clause must not normalise itself up to full gape —
 * and the last frame, so a one-frame dip at a chunk seam is smoothed like any
 * other.
 */
export function createLipSync(sampleRate: number): LipSync {
  const size = Math.max(1, Math.round((sampleRate * LIPSYNC_FRAME_MS) / 1000));
  let peak = 0;
  let last: VisemeKey = 'sil';
  return {
    analyze(pcm) {
      const feats: FrameFeatures[] = [];
      for (let s = 0; s < pcm.length; s += size) {
        const f = frameFeatures(pcm, s, Math.min(pcm.length, s + size), sampleRate);
        feats.push(f);
        // Peaks decay slowly, so one shout early on doesn't mute the rest.
        peak = Math.max(peak * 0.995, f.rms);
      }
      const out = smooth(
        feats.map((f) => classifyFrame(f, peak)),
        last,
      );
      if (out.length) last = out[out.length - 1];
      return out;
    },
  };
}

/**
 * A single silent frame between sounds is a stop closing (the b in "maybe"),
 * not a pause: draw it as pressed lips rather than flicking to rest and back.
 */
export function smooth(frames: VisemeKey[], before: VisemeKey): VisemeKey[] {
  const out = frames.slice();
  for (let i = 0; i < out.length; i++) {
    const prev = i === 0 ? before : frames[i - 1];
    const next = frames[i + 1];
    if (out[i] === 'sil' && prev !== 'sil' && next !== undefined && next !== 'sil') out[i] = 'MBP';
  }
  return out;
}

/**
 * When each scheduled chunk becomes audible, and what the mouth does during it.
 *
 * The queue node plays buffers back to back, so a chunk starts either when the
 * one before it ends or, if the queue had run dry, the moment it is handed
 * over. That is known at scheduling time, which is the point: waiting for the
 * native buffer-ended event to say "next chunk now" would land every chunk late
 * by the bridge's latency, and a mouth that trails the voice reads as dubbed.
 */
export interface MouthSegment {
  startedAt: number;
  frames: VisemeKey[];
}

export interface MouthTimeline {
  segments: MouthSegment[];
  /** When everything scheduled so far will have played. */
  endsAt: number;
}

export const EMPTY_TIMELINE: MouthTimeline = { segments: [], endsAt: 0 };

export function appendSegment(
  tl: MouthTimeline,
  frames: VisemeKey[],
  durationMs: number,
  now: number,
): MouthTimeline {
  const startedAt = Math.max(now, tl.endsAt);
  // Anything already played out is dead weight on every lookup.
  const live = tl.segments.filter((s) => s.startedAt + s.frames.length * LIPSYNC_FRAME_MS > now);
  return { segments: [...live, { startedAt, frames }], endsAt: startedAt + durationMs };
}

/** The viseme under the playhead; rest between and after segments. */
export function visemeOnTimeline(tl: MouthTimeline, now: number): VisemeKey {
  for (const s of tl.segments) {
    if (now < s.startedAt) break;
    const i = Math.floor((now - s.startedAt) / LIPSYNC_FRAME_MS);
    if (i < s.frames.length) return s.frames[i];
  }
  return 'sil';
}
