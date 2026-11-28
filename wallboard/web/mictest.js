// Microphone probe for the Echo Show (ASC-52): can the board hear the kitchen?
// Pure, so it's testable under node; mic.html runs the probe and calls these.
//
// The question has three answers, and the ticket wants to know which one:
//   works          — getUserMedia gave us a live track and the level moved.
//   blocked-silk   — the browser refused, or never had the API.
//   blocked-device — the browser asked, but there is no microphone for it to
//                    give (Echo Show's mic-off button, or the OS not exposing one).
// Plus 'granted-silent' (a track, but the meter never moved: the mic-off button
// usually feeds silence rather than failing) and 'inconclusive' (not finished).

/** Peak level above this (0..1, RMS of the time-domain signal) counts as hearing something. */
export const HEARD_LEVEL = 0.02;

/** Map a getUserMedia rejection (DOMException name) to who refused. */
export function blame(errorName) {
  switch (errorName) {
    case 'NotFoundError':       // no audioinput device at all
    case 'NotReadableError':    // device exists but the OS/hardware won't open it
    case 'OverconstrainedError':
      return 'blocked-device';
    default:
      // NotAllowedError / SecurityError / anything unknown: the browser said no,
      // whether by policy or by its own prompt. The page records whether a
      // prompt was seen, which tells those two apart in the report.
      return 'blocked-silk';
  }
}

/** RMS of a Uint8Array from AnalyserNode.getByteTimeDomainData (128 = silence), 0..1. */
export function rms(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

/**
 * The overall verdict from a finished (or partial) report:
 * {secure, hasMediaDevices, gum: 'ok'|'error'|null, error, peak}
 */
export function verdict(r) {
  if (r.secure === false || r.hasMediaDevices === false) return 'blocked-silk';
  if (r.gum === 'error') return blame(r.error);
  if (r.gum === 'ok') {
    if (typeof r.peak !== 'number') return 'inconclusive';
    return r.peak >= HEARD_LEVEL ? 'works' : 'granted-silent';
  }
  return 'inconclusive';
}

/** One line for the screen, so the person in the kitchen can read the answer. */
export function describe(v) {
  return {
    works: 'Works — the board can hear the room.',
    'granted-silent': 'Mic granted, but nothing heard. Is the Echo’s mic-off button on? Speak and re-check.',
    'blocked-silk': 'Blocked by Silk — the browser will not give the page a microphone.',
    'blocked-device': 'Blocked by the Echo Show — no microphone available to the browser.',
    inconclusive: 'Not finished yet.',
  }[v] ?? v;
}

/** Speech recognition, as a separate question: is the API there, and what did it say? */
export function speechApi(w) {
  if (typeof w.SpeechRecognition === 'function') return 'SpeechRecognition';
  if (typeof w.webkitSpeechRecognition === 'function') return 'webkitSpeechRecognition';
  return null;
}
