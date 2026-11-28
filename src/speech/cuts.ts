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
// `describeCut`, `readUtterance` and `readReply` are pure and tested; the slot
// and the log are thin.

import { appendLog, clearLog, readLog, type WakeEvent } from './wakeLog';
import type { PlaybackStats } from './audioOut';

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

// -- Per-reply trace ----------------------------------------------------------
//
// A cut is only the losses something *decided*. A reply can also come up short
// with nothing deciding it — "the last sentence, a question about Cedric, was
// never heard, though the text was complete" (Nov 28) — and that ends as an
// ordinary drain. So every reply is traced at the two places text can go
// missing, and the numbers say which stage lost it:
//
//   reply      text the brain delivered  vs  text handed to the speaker
//              (lost here: the transport or the sentence splitter)
//   utterance  text handed to the speaker vs  seconds of audio synthesized
//              (far too little audio for the text: Kokoro dropped some)
//              seconds synthesized       vs  seconds actually played
//              (lost here: the player), and how it ended
//
// Each is a line in the persisted speech log; a suspect one is also a
// transcript line. They are matched to each other, and to hermes' own session
// history, by time.

/**
 * Kokoro at speed 1.0 speaks roughly this many characters of English a
 * second. Only used to flag audio far shorter than its text, with a factor of
 * two of slack, so it needs to be right in magnitude, not in detail.
 */
export const CHARS_PER_SECOND = 15;
/** Audio below this share of what the text should take reads as dropped text. */
export const SHORT_AUDIO_RATIO = 0.5;
/** Seconds of synthesized audio that may go unplayed before it reads as lost. */
const UNPLAYED_SLACK_S = 0.5;

export interface UtteranceTrace {
  /** Everything handed to the speaker for this utterance. */
  text: string;
  /** The cut reason when one was decided; otherwise how playback ended. */
  end: string;
  stats: PlaybackStats;
  /** Whether the recognizer was running as it ended — it never should be. */
  micOpen: boolean;
  /** React Native AppState at the end; anything but 'active' is a suspect. */
  appState: string;
}

export interface TraceReading {
  line: string;
  /** Why this one looks wrong, or null when it doesn't. */
  suspect: string | null;
}

const secs = (s: number) => `${s.toFixed(1)}s`;

export function readUtterance(t: UtteranceTrace): TraceReading {
  const chars = t.text.trim().length;
  const expected = chars / CHARS_PER_SECOND;
  const { synthesizedS, playedS, underruns } = t.stats;
  const suspects: string[] = [];
  if (t.end !== 'drained') suspects.push(`ended ${t.end}`);
  // A short line has too little audio to judge by rate.
  if (expected >= 3 && synthesizedS < expected * SHORT_AUDIO_RATIO) suspects.push('too little audio for its text');
  if (t.stats.how === 'drained' && synthesizedS - playedS > UNPLAYED_SLACK_S) suspects.push('audio synthesized but not played');
  if (t.micOpen) suspects.push('mic was open');
  if (t.appState !== 'active') suspects.push(`app ${t.appState}`);
  const line =
    `utterance · ${chars} chars · ${secs(synthesizedS)} synthesized / ${secs(playedS)} played (text ≈ ${secs(expected)})` +
    `${underruns ? ` · ${underruns} underrun${underruns === 1 ? '' : 's'}` : ''} · ${t.end}` +
    (chars ? ` · "${tailOf(t.text)}"` : '');
  return { line, suspect: suspects.length ? suspects.join(', ') : null };
}

export interface ReplyTrace {
  /** The round's outcome kind: reply, timeout, offline, error. */
  kind: string;
  /** The speakable text the brain delivered. */
  received: string;
  /** The answer text actually handed to the speaker. */
  pushed: string;
}

/** Letters and digits only, lower-cased: what survives every flattening on the way to the speaker. */
const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const TAIL_PROBE = 24;

export function readReply(t: ReplyTrace): TraceReading {
  const got = letters(t.received);
  const said = letters(t.pushed);
  // Its last words are the check, not its length: a preamble cleared at a tool
  // boundary makes lengths differ on a perfectly good reply.
  const tail = got.slice(-TAIL_PROBE);
  const suspects: string[] = [];
  if (t.kind !== 'reply') suspects.push(t.kind);
  if (tail && !said.includes(tail)) suspects.push('its last words never reached the speaker');
  const line =
    `reply · ${t.kind} · ${t.received.trim().length} chars received, ${t.pushed.trim().length} to the speaker` +
    (t.received.trim() ? ` · ends "${tailOf(t.received)}"` : '');
  return { line, suspect: suspects.length ? suspects.join(', ') : null };
}

// -- Reporting ----------------------------------------------------------------

export type SpeechEvent =
  | { kind: 'cut'; cut: SpeechCut }
  | { kind: 'utterance'; trace: UtteranceTrace }
  | { kind: 'reply'; trace: ReplyTrace };

type Listener = (e: SpeechEvent) => void;
let listener: Listener | null = null;

/** FaceScreen subscribes once; the speech layer reports without knowing who listens. */
export function onSpeechEvent(l: Listener | null): void {
  listener = l;
}

function emit(e: SpeechEvent): void {
  try {
    listener?.(e);
  } catch {
    // Diagnostics must never take the speaker down with them.
  }
}

export const reportCut = (cut: SpeechCut): void => emit({ kind: 'cut', cut });
export const reportUtterance = (trace: UtteranceTrace): void => emit({ kind: 'utterance', trace });
export const reportReply = (trace: ReplyTrace): void => emit({ kind: 'reply', trace });

/** One log line for any event, and whether it belongs in the transcript too. */
export function readEvent(e: SpeechEvent): TraceReading {
  if (e.kind === 'cut') return { line: describeCut(e.cut), suspect: e.cut.reason };
  return e.kind === 'utterance' ? readUtterance(e.trace) : readReply(e.trace);
}

export const SPEECH_LOG_KEY = 'eva.speechLog.v1';

export const getSpeechLog = (): Promise<WakeEvent[]> => readLog(SPEECH_LOG_KEY);
export const appendSpeechLog = (line: string): Promise<WakeEvent[]> => appendLog(SPEECH_LOG_KEY, line);
export const clearSpeechLog = (): Promise<void> => clearLog(SPEECH_LOG_KEY);
