// How much synthesized audio to hold before letting it play — pure, no I/O.
//
// Kokoro streams audio out in small chunks, and audioOut used to hand each one
// straight to the player and start on the first. That plays as fast as it can
// synthesize, which is fine until synthesis briefly falls behind real time:
// the queue empties, and the gap lands wherever playback happened to be —
// mid-word, mid-sentence. That is the stutter, and it is a starved buffer
// rather than anything to do with how the text was split.
//
// The fix is an ordinary jitter buffer. Build a lead before starting, then
// stream freely; if the queue ever does run dry with more input still coming,
// rebuild the lead instead of resuming on a single chunk and starving again a
// moment later. One deliberate gap beats four ragged ones.
//
// Policy lives here, away from react-native-audio-api, so it can be tested:
// audioOut.ts imports the native module and cannot be loaded under jest.

/**
 * The lead to build before audio starts. Long enough to absorb a slow patch of
 * synthesis, short enough not to be heard as hesitation — it is paid once per
 * utterance, and the realtime brain's faster first token already covers most
 * of it.
 */
export const PREBUFFER_SECONDS = 0.8;

export interface JitterState {
  /** Chunks received but deliberately not handed to the player yet. */
  held: Float32Array[];
  heldSeconds: number;
  /** True while a lead is being built — before the first note and after a dry queue. */
  buffering: boolean;
}

export function emptyJitter(): JitterState {
  return { held: [], heldSeconds: 0, buffering: true };
}

/** Nothing held, nothing buffering: the state after everything is released. */
function flushed(buffering: boolean): JitterState {
  return { held: [], heldSeconds: 0, buffering };
}

/**
 * Take one synthesized chunk. `flush` is what should go to the player now, in
 * arrival order — empty while the lead is still being built.
 */
export function offer(
  state: JitterState,
  chunk: Float32Array,
  seconds: number,
  threshold: number = PREBUFFER_SECONDS,
): { state: JitterState; flush: Float32Array[] } {
  const held = [...state.held, chunk];
  const heldSeconds = state.heldSeconds + seconds;
  if (state.buffering && heldSeconds < threshold) {
    return { state: { held, heldSeconds, buffering: true }, flush: [] };
  }
  return { state: flushed(false), flush: held };
}

/**
 * The queue ran dry while more audio is still coming. Rebuild the lead rather
 * than feeding the player the next chunk the instant it appears.
 */
export function underrun(state: JitterState): JitterState {
  return { ...state, buffering: true };
}

/**
 * No more input is coming: release whatever is held, however short. A reply of
 * two words must not sit waiting for a lead that will never arrive.
 */
export function drain(state: JitterState): { state: JitterState; flush: Float32Array[] } {
  return { state: flushed(false), flush: state.held };
}
