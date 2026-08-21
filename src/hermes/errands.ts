// Errands: questions Eva hands to her other half and walks away from.
//
// Pure policy — no React, no I/O, unit-tested. The running lives in
// useErrands.ts and the delivery is the proactive queue's, not ours.
//
// The shape exists because of one measurement: a hermes answer took 88.7s on
// the gateway. That is not a tool gap you can hold a speaker open through, and
// it is not something to make someone stand and wait for. So the tool that
// starts an errand RETURNS IMMEDIATELY, the round settles at local speed, Eva
// says she will come back to him, and the answer arrives later through the same
// path her unprompted Slack messages already take.
//
// The thing that makes this feel like an assistant rather than a dropped
// request is `deliveryLine`: minutes have passed and the conversation has moved
// on, so an answer that arrives naked is a non-sequitur. It has to re-anchor to
// what was asked.

/** Running at once. Each is a full agent run on hermes' side — not cheap. */
export const MAX_RUNNING = 2;

/** Waiting behind those. Past this she declines rather than promising. */
export const MAX_QUEUED = 4;

export type ErrandState = 'queued' | 'running' | 'done' | 'failed';

export interface Errand {
  id: string;
  /** What Eva asked hermes, in her words. Re-anchors the answer on delivery. */
  question: string;
  /**
   * Whether hermes should reach for its tools — Eva's call, per request.
   *
   * It is the difference between a fast answer from memory and a full agent run
   * with calendar and task lookups, which is where the 88.7s went. She is the
   * only one in a position to know which the question needs.
   */
  needsLookup: boolean;
  startedAt: number;
  state: ErrandState;
}

/**
 * What the tool hands back to the model, immediately.
 *
 * It has to do two things at once: stop her waiting, and stop her saying the
 * same sentence twice. She has already spoken a preamble by the time this
 * arrives — that is how the tool gap is covered everywhere else — so this asks
 * for a short acknowledgement and then for the conversation to carry on.
 */
export const STARTED =
  'Sent. It will be a couple of minutes. Say briefly that you will come back to him on it — different words to the ones you just used, not a repeat — then answer anything else he asked and carry on normally. Do not wait for it and do not mention it again until it arrives.';

export const BUSY =
  'You already have as many of these in flight as you can carry. Tell him you are still working through the last ones and ask him to come back to this shortly.';

/**
 * The request as hermes receives it.
 *
 * Three instructions beyond the question itself, all of them load-bearing:
 *
 * - Brevity, because the answer is read aloud in a room and hermes writing for
 *   a chat window produces paragraphs nobody can listen to.
 * - Low reasoning, because this is a question with an answer, not a research
 *   task, and hermes will happily spend minutes on it otherwise.
 * - Tools, or not, from Eva's judgement. A question about what is on his
 *   calendar needs them; one about what he decided last week does not, and the
 *   difference is most of the wall-clock.
 */
export function errandRequest(question: string, needsLookup: boolean): string {
  const lookup = needsLookup
    ? 'Use whatever tools you need to answer this properly.'
    : 'Answer from what you already know and remember. Do not use tools for this one — it was sent as a question you can answer directly, and a lookup would only make it slow.';

  return `${question}

This is from Eva, on Michael's desk, and your answer will be read out loud to him by a speech synthesizer in a room where other people can hear it.

${lookup}

Keep your reasoning brief — this is a quick question, not a research task. Answer in two or three sentences at most, in plain conversational prose. No markdown, no bullets, no ids or URLs or file paths, and no preamble about what you did to find out. Say numbers, dates, and times the way a person says them out loud. If you could not find out, say so in one sentence rather than explaining why.`;
}

/**
 * The answer as Eva says it, minutes later.
 *
 * `question` leads because the conversation has moved on. Without it she
 * announces an answer to nothing, which is worse than saying nothing at all —
 * the listener has to reconstruct what she is talking about while she is
 * already talking.
 */
export function deliveryLine(question: string, answer: string): string {
  return `Coming back to ${anchor(question)} — ${answer.trim()}`;
}

export function failureLine(question: string): string {
  return `I couldn't get an answer about ${anchor(question)}. I can try again if you want.`;
}

/**
 * The question turned into something that reads after "coming back to".
 *
 * Lower-cased, stripped of its question mark, and trimmed to a clause. A
 * question Eva composed is already short, but she is fed transcribed speech and
 * occasionally writes a long one, and a thirty-word anchor buries the answer
 * behind it.
 */
export function anchor(question: string): string {
  const cleaned = question.trim().replace(/[?.!]+$/, '');
  const lowered = /^[A-Z][a-z]/.test(cleaned) ? cleaned[0].toLowerCase() + cleaned.slice(1) : cleaned;
  const words = lowered.split(/\s+/);
  return words.length <= 12 ? lowered : `${words.slice(0, 12).join(' ')}…`;
}

/** Room for another, or null when she should decline instead of promising. */
export function canAccept(errands: Errand[]): boolean {
  const live = errands.filter((e) => e.state === 'queued' || e.state === 'running');
  return live.length < MAX_RUNNING + MAX_QUEUED;
}

/** The next errand to run, or null when the runners are full or nothing waits. */
export function nextToRun(errands: Errand[]): Errand | null {
  if (errands.filter((e) => e.state === 'running').length >= MAX_RUNNING) return null;
  return errands.find((e) => e.state === 'queued') ?? null;
}
