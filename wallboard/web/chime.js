// Countdown sounds (ASC-32): a cute robot "beep boop" when the Next-up card
// starts counting down, and a little music-box alarm at five minutes out.
//
// Generated, not recorded, like the desk's wake earcons (src/speech/earcon.ts):
// no asset, no loader, nothing for Silk to fetch or decode. Pure PCM maths plus
// the policy for when each cue plays, so both are testable under node; app.js
// only owns the Audio element and the clock.

export const RATE = 22050;
export const ALARM_MIN = 5;          // the alarm fires at this many minutes out

/**
 * A cue is a list of notes played back to back. `shape` picks the envelope:
 *  - `blip`: raised cosine over the whole note (zero at both ends, so no click),
 *    with a touch of 2nd and 3rd harmonic for a buzzy little-robot voice.
 *  - `bell`: 4 ms attack, exponential decay, pure-ish tone with a soft octave
 *    partial — a music-box ding. The tail is faded to zero at the end.
 * `toFreq` glides the pitch across the note; `gap` is silence after it.
 */

/** "Beep boop… bip!": the timer is on. */
export const ANNOUNCE = [
  { freq: 988, ms: 90, gap: 40, gain: 0.32, shape: 'blip' },                 // beep
  { freq: 587, toFreq: 440, ms: 150, gap: 70, gain: 0.34, shape: 'blip' },   // boop
  { freq: 784, toFreq: 1568, ms: 110, gap: 0, gain: 0.3, shape: 'blip' },    // bip! (rising: a question, a perk-up)
];

const ding = (freq, ms = 260) => ({ freq, ms, gap: 30, gain: 0.34, shape: 'bell' });
/** Twice up a C-major arpeggio, then a held high C: five minutes to go. */
export const ALARM = [
  ding(1047), ding(1319), ding(1568), { ...ding(2093, 220), gap: 180 },
  ding(1047), ding(1319), ding(1568), { ...ding(2093, 700), gap: 0 },
];

/**
 * Render a cue as mono PCM in [-1, 1]. Phase is accumulated rather than
 * computed from absolute time, so a pitch glide doesn't buzz.
 */
export function render(cue, rate = RATE) {
  const samples = (ms) => Math.round((ms / 1000) * rate);
  const total = cue.reduce((n, c) => n + samples(c.ms) + samples(c.gap ?? 0), 0);
  const pcm = new Float32Array(total);
  let at = 0;
  for (const c of cue) {
    const len = samples(c.ms);
    const to = c.toFreq ?? c.freq;
    const attack = Math.round(0.004 * rate);
    const fade = Math.round(0.02 * rate);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const p = len > 1 ? i / (len - 1) : 0;
      const f = c.freq + (to - c.freq) * p;
      let s, env;
      if (c.shape === 'bell') {
        s = Math.sin(phase) * 0.8 + Math.sin(2 * phase) * 0.2;
        env = Math.min(1, i / attack) * Math.exp(-5 * (i / rate) / (c.ms / 1000)) * Math.min(1, (len - 1 - i) / fade);
      } else {
        s = (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase)) / 1.45;
        env = 0.5 * (1 - Math.cos(2 * Math.PI * p));
      }
      pcm[at + i] = s * env * c.gain;
      phase += (2 * Math.PI * f) / rate;
    }
    at += len + samples(c.gap ?? 0);
  }
  return pcm;
}

/** 16-bit mono WAV bytes for `pcm`. */
export function wav(pcm, rate = RATE) {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return buf;
}

/**
 * Which cue to play now, if any, for the Next-up card `up` (`{key, mins}` or
 * null), given the set of cues already played today (`"<key>:announce"`,
 * `"<key>:alarm"`). Returns `{cue, mark}`: the cue to play (or null) and the
 * entries to add to the set.
 *
 * - The card appearing with more than ALARM_MIN to go: announce, once.
 * - ALARM_MIN or less to go: the alarm, once. If the card first shows up already
 *   that close (an event added late, a board switched on late), the alarm plays
 *   alone — the announce is marked as done so it can't follow it.
 * Played-ness is per event key, so two events in one window each get theirs.
 */
export function cueFor(up, played) {
  if (!up || !(up.mins > 0)) return { cue: null, mark: [] };
  const a = `${up.key}:announce`, z = `${up.key}:alarm`;
  if (up.mins <= ALARM_MIN) return played.has(z) ? { cue: null, mark: [] } : { cue: 'alarm', mark: [a, z] };
  return played.has(a) ? { cue: null, mark: [] } : { cue: 'announce', mark: [a] };
}
