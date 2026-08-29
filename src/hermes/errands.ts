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
//
// An errand comes in two kinds and the queue does not care which: a QUESTION,
// which changes nothing and whose worst failure is silence, and an ACTION,
// which changes something in Michael's world and whose worst failure is a
// confident report of something that did not happen. Everything below that
// differs between them differs for that one reason. In particular
// `actionFailureLine` is not `failureLine` with different words: a question we
// could not send simply did not happen, while an action may well have landed
// and completed on hermes' side with only the report lost, so the honest thing
// to say is that she does not know.

/** Running at once. Each is a full agent run on hermes' side — not cheap. */
export const MAX_RUNNING = 2;

/** Waiting behind those. Past this she declines rather than promising. */
export const MAX_QUEUED = 4;

/** Words an anchor keeps before it trims — the spoken default. */
const ANCHOR_WORDS = 12;

/** And what a consent readback keeps, where a buried tail is the worse risk. */
const READBACK_WORDS = 20;

export type ErrandState = 'queued' | 'running' | 'done' | 'failed';

export type ErrandKind = 'question' | 'action';

export interface Errand {
  id: string;
  /**
   * What Eva sent hermes, in her words — a question, or an instruction when
   * `kind` is 'action'. Re-anchors the report on delivery either way.
   */
  question: string;
  /**
   * Which of the two this is. The queue, the caps and the runner are shared;
   * what differs is the request hermes receives, the line Eva speaks when it
   * comes back, and whether it is written to the outbox.
   */
  kind: ErrandKind;
  /**
   * Whether hermes should reach for its tools — Eva's call, per question.
   * Ignored for actions, which always need them: doing the thing is the point.
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
 * What the tool hands back the moment an action is dispatched.
 *
 * The extra clause over STARTED is "do not say it is done", and it is the whole
 * difference. A model that has just been told its instruction was sent will
 * otherwise report the change as complete in the same breath — which is a lie
 * for the minute or two before it actually is, and an unrecoverable one if the
 * action then fails.
 */
export const SENT =
  'Passed to him and he is doing it now. He will report back in a minute or two. Say briefly that you have handed it over — different words to the ones you just used, not a repeat — then carry on normally. Do NOT say it is done: it is not done yet, and you will be told when it is. Do not wait for it and do not mention it again until it comes back.';

/** The spoken gate said no. Nothing was sent and nothing has changed. */
export const DECLINED =
  'Michael said no. It was not sent and nothing has been changed. Let it go, and do not try it again unless he brings it up.';

/**
 * The request as hermes receives it when Eva wants something *done*.
 *
 * Four instructions beyond the action itself:
 *
 * - Do it. A capable agent handed a sentence in the imperative will otherwise
 *   sometimes answer it as a question about whether it should be done.
 * - Report what actually happened, in one spoken sentence, under the same
 *   read-aloud-in-a-room rules the answer path uses.
 * - Never describe an intention as an outcome. This is the failure that would
 *   make her untrustworthy rather than merely unlucky: Eva reads the report out
 *   as fact, minutes later, and nobody checks.
 * - Do not ask anything back. There is no channel — the report is spoken once
 *   and the conversation it came from is long over. A question returned here is
 *   heard as a non-sequitur and answered by nobody.
 */
export function actionRequest(action: string): string {
  return `${action}

This is from Eva, on Michael's desk. It is an instruction to carry out, not a question to answer — go and do it, using whatever tools you need.

When it is done, say in one sentence what you actually did. It will be read out loud to him by a speech synthesizer in a room where other people can hear it, so use plain conversational prose: no markdown, no bullets, no ids or URLs or file paths, and say numbers, dates, and times the way a person says them out loud.

If you could not do it, say so plainly in one sentence and say what stopped you. Never describe what you would have done as though you had done it — he will hear your sentence as fact and will not check. And do not ask him a question back: he cannot answer, and anything you send is spoken to him once, minutes from now, with no way to reply.`;
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
 * An action report, minutes later. Covers both outcomes: hermes was asked for
 * one sentence about what actually happened, and that sentence is as likely to
 * say it could not as to say it did.
 *
 * "You asked me to" leads rather than "coming back to", because an action
 * report read cold is ambiguous in a way an answer is not — "that's on your
 * list now" could be about anything.
 */
export function doneLine(action: string, report: string): string {
  return `You asked me to ${anchor(action)} — ${report.trim()}`;
}

/**
 * We never heard back about an action. Deliberately not a failure line.
 *
 * The request reached hermes, or may have; what died was our side of it. So the
 * one thing this must not say is that the action did not happen, because it may
 * perfectly well have happened. Saying "I don't know" is the only version of
 * this that is true in both worlds, and the only one that prompts the check
 * that would settle it.
 */
export function actionFailureLine(action: string): string {
  return `I never heard back about ${anchor(action)}, so I don't know whether it went through. Worth a check.`;
}

/**
 * Spoken by the gate when a destructive action needs confirming and the model
 * emitted no preamble of its own to serve as the question (see useEcho's
 * askForConsent, and CONSENT_QUESTION which this parallels).
 *
 * It gets a longer leash than `anchor`'s spoken default: truncating the thing
 * someone is being asked to consent to is its own hazard. Note the action is
 * written for hermes, who calls him Michael, so a fallback readback can end up
 * in the third person — the model's own preamble is the primary path here and
 * is addressed to him directly.
 */
export function readbackLine(action: string): string {
  return `Just to check — you want me to ${anchor(action, READBACK_WORDS)}?`;
}

/**
 * What Eva says at bring-up about actions the last process never settled — one
 * line, however many there were. Null when there is nothing to report, which is
 * the overwhelmingly common case.
 *
 * Counted rather than recited: three actions read out in full is a paragraph
 * nobody asked for, arriving before he has said anything.
 */
export function unfinishedLine(actions: string[]): string | null {
  if (actions.length === 0) return null;
  if (actions.length === 1) {
    return `Before we restarted I'd sent your other half one thing — ${anchor(actions[0])} — and never heard back whether it went through. Worth a check.`;
  }
  return `Before we restarted I'd sent your other half ${count(actions.length)} things and never heard back whether they went through. Worth a check.`;
}

/** Small numbers read aloud as words; past that the digits are clearer anyway. */
function count(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n);
}

/**
 * The question turned into something that reads after "coming back to".
 *
 * Lower-cased, stripped of its question mark, and trimmed to a clause. A
 * question Eva composed is already short, but she is fed transcribed speech and
 * occasionally writes a long one, and a thirty-word anchor buries the answer
 * behind it.
 *
 * `words` is the trim, and the default is the spoken one. Only the consent
 * readback raises it, where burying the tail matters more than the length.
 */
export function anchor(question: string, words = ANCHOR_WORDS): string {
  const cleaned = question.trim().replace(/[?.!]+$/, '');
  const lowered = /^[A-Z][a-z]/.test(cleaned) ? cleaned[0].toLowerCase() + cleaned.slice(1) : cleaned;
  const parts = lowered.split(/\s+/);
  return parts.length <= words ? lowered : `${parts.slice(0, words).join(' ')}…`;
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
