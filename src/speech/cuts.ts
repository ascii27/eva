// Why Eva stopped talking before she had finished (ASC-67).
//
// Reported at a busy Thanksgiving: replies stopping mid-sentence, as if she
// heard something. The mic is never open while she speaks — the wake watcher
// is suspended on any non-idle face and the follow-up mic opens only after the
// reply has drained — so room noise cannot barge in. What *can* end audible
// speech early is all on the device: a newer round or the mic taking the
// speaker, the real reply cutting off a filler aside, audioOut's stall
// watchdog, or the brain's stream dying part-way through an answer.
//
// None of those left a trace on the desk: every one of them was a `__DEV__`
// console line, and the phone runs a release (preview) build. So each early
// end is reported here, shown in the transcript and kept in a capped on-device
// log the overlay reads — the evidence the next noisy evening produces.
//
// `describeCut` is pure and tested; the slot and the log are thin.

import { appendLog, clearLog, readLog, type WakeEvent } from './wakeLog';

export type CutReason =
  /** A newer utterance or round took the speaker (wake, announce, a new reply). */
  | 'superseded'
  /** The recognizer is coming up for a listen while she was still talking. */
  | 'mic opening'
  /** The real reply arrived and stopped a filler aside mid-line. */
  | 'reply over aside'
  /** The overlay, or a manual face pick, abandoned the round. */
  | 'cancelled'
  /** A failed round's confused face silenced whatever was still playing. */
  | 'error'
  /** audioOut's watchdog saw no playback progress and forced the end. */
  | 'playback stalled'
  /** The brain's clock ran out with part of the answer already spoken. */
  | 'reply timed out'
  /** The brain's stream failed with part of the answer already spoken. */
  | 'reply failed'
  | 'unmount';

export interface SpeechCut {
  reason: CutReason;
  /** What she was saying (for a stream, everything handed to the speaker so far). */
  text: string;
  /** How long it had been audible, when known. */
  playedMs?: number;
}

const TAIL_CHARS = 48;

/** The last few words of what she was saying, cut at a word boundary. */
export function tailOf(text: string, max = TAIL_CHARS): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  const space = cut.indexOf(' ');
  return `…${space > 0 && space < cut.length - 1 ? cut.slice(space + 1) : cut}`;
}

/** One transcript / log line: `cut after 3.4s (playback stalled) · "…the last words"`. */
export function describeCut(c: SpeechCut): string {
  const when = c.playedMs === undefined ? 'cut' : `cut after ${(c.playedMs / 1000).toFixed(1)}s`;
  const tail = tailOf(c.text);
  return `${when} (${c.reason})${tail ? ` · "${tail}"` : ''}`;
}

type Listener = (c: SpeechCut) => void;
let listener: Listener | null = null;

/** FaceScreen subscribes once; the speech layer reports without knowing who listens. */
export function onSpeechCut(l: Listener | null): void {
  listener = l;
}

export function reportCut(c: SpeechCut): void {
  try {
    listener?.(c);
  } catch {
    // Diagnostics must never take the speaker down with them.
  }
}

export const SPEECH_CUTS_KEY = 'eva.speechCuts.v1';

export const getSpeechCuts = (): Promise<WakeEvent[]> => readLog(SPEECH_CUTS_KEY);
export const appendSpeechCut = (line: string): Promise<WakeEvent[]> => appendLog(SPEECH_CUTS_KEY, line);
export const clearSpeechCuts = (): Promise<void> => clearLog(SPEECH_CUTS_KEY);
