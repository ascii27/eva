// Where the face finds out what the mouth should be doing right now (ASC-53).
//
// audioOut publishes the timeline of the utterance it is playing; Face's Mouth
// polls it. A module-level slot rather than a callback threaded up through
// tts → useEcho → FaceScreen like onFlowing: this changes every 50ms, and
// routing it through FaceScreen's state would re-render the whole screen at
// that rate for the sake of one shape.
//
// Nothing published means no audio-driven mouth is available — the system
// voice, which plays inside iOS where no PCM is visible — and the face falls
// back to its canned loop.

import { visemeOnTimeline, type MouthTimeline } from '../face/lipsync';
import type { VisemeKey } from '../face/visemes';

let owner: object | null = null;
let timeline: MouthTimeline | null = null;

export function publishMouth(who: object, tl: MouthTimeline): void {
  owner = who;
  timeline = tl;
}

/**
 * Only the utterance that published may clear: a stopped utterance winding
 * down late must not wipe out the one that replaced it.
 */
export function clearMouth(who: object): void {
  if (owner !== who) return;
  owner = null;
  timeline = null;
}

/** The viseme under the playhead, or undefined when no timeline is live. */
export function liveViseme(now: number): VisemeKey | undefined {
  return timeline ? visemeOnTimeline(timeline, now) : undefined;
}
