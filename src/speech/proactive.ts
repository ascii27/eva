// Pure proactive-push policy — no React. Decides which of Eva's unprompted
// Slack messages get spoken and in what order; useSlack/FaceScreen drive the
// side effects. Two pieces of state, both owned by the caller:
//
//   adoptions — thread roots Eva has @-mentioned us in, with their last
//               activity, so a workstream keeps speaking without re-mentioning
//   queue     — messages waiting for a quiet face
//
// Expiry is checked lazily on every message rather than by a timer, the same
// way conversation.ts checks its follow-up deadline at session boundaries.

import type { MessageEvent } from '../slack/protocol';
import { speakableFromMrkdwn } from '../round/speakable';
import { isToolEcho } from '../slack/sanitize';
import { asksForBattery, asksForLight, readBrightness, readDirective, wantsLook, type BrightnessToken, type DeskDirective } from '../round/directives';

/** isToolEcho's signature: a tool echo opens with an emoji-code label. */
const TOOL_LABEL_RE = /^\s*:[a-z0-9_+\-]+:/;

/** Backlog cap. Beyond this the oldest is dropped — it stays in the transcript. */
export const PROACTIVE_QUEUE_MAX = 5;
/** A thread stops speaking after this much silence; any Eva message refreshes it. */
export const ADOPTION_IDLE_MS = 30 * 60_000;
/** Ceiling on tracked threads, newest kept. */
export const ADOPTION_MAX = 20;

export interface ProactiveItem {
  /** Slack ts of the message — the identity used to drop it if it settles an ask. */
  ts: string;
  /**
   * Thread root to answer into, or null when there is nothing to answer into.
   *
   * Null is the honest state for anything that did not arrive over Slack — an
   * errand answer from hermes, or the overlay's test line. Without it a
   * follow-up on the Slack brain would be posted into a thread that does not
   * exist, and silently go nowhere.
   */
  threadTs: string | null;
  /** Already flattened for speech. */
  text: string;
  at: number;
  /**
   * A desk directive to carry out once this has been spoken — `sleep` from a
   * "goodnight" hermes sent, so she says it before she drifts off rather than
   * falling asleep with it still queued (which the speaking would undo).
   */
  after?: DeskDirective;
  /**
   * hermes is asking to see through the camera (`[[look]]`, ASC-43). `text` is
   * the consent question — empty when the message was only the token, and the
   * gate then asks in its own words. Nothing is captured without a spoken yes.
   */
  look?: true;
}

/** Adopted thread root → last-activity epoch ms. */
export type Adoptions = Record<string, number>;

/**
 * A thread whose exchange is still going. Eva settles a round with her first
 * substantive message but often posts a trailing restatement seconds later;
 * that belongs to the exchange that just happened, not to a new announcement,
 * and speaking it again is the same answer twice with its own alert beat.
 */
export interface LiveExchange {
  threadTs: string;
  /** Epoch ms the exchange stops being live; null while it's still on screen. */
  until: number | null;
}

function isLive(live: LiveExchange | null, root: string, now: number): boolean {
  if (!live || live.threadTs !== root) return false;
  return live.until === null || now < live.until;
}

/** The thread a message belongs to; a root message is its own thread. */
export function threadRoot(ev: MessageEvent): string {
  return ev.thread_ts ?? ev.ts;
}

/** True when the raw mrkdwn addresses our bot user — the adoption signal. */
export function mentionsBot(raw: string, botUserId: string): boolean {
  // Slack sends bare <@U123>, but tolerate the <@U123|label> form too.
  return new RegExp(`<@${botUserId}(\\|[^>]*)?>`).test(raw);
}

/** Speakable form of an Eva message, or null when it must not be spoken. */
export function announceable(raw: string): string | null {
  if (isToolEcho(raw)) return null;
  return speakableFromMrkdwn(raw) || null;
}

function prune(adoptions: Adoptions, now: number): Adoptions {
  const kept: Adoptions = {};
  for (const [root, at] of Object.entries(adoptions)) {
    if (now - at < ADOPTION_IDLE_MS) kept[root] = at;
  }
  return kept;
}

function cap(adoptions: Adoptions): Adoptions {
  const roots = Object.keys(adoptions);
  if (roots.length <= ADOPTION_MAX) return adoptions;
  const kept: Adoptions = {};
  for (const root of roots.sort((a, b) => adoptions[b] - adoptions[a]).slice(0, ADOPTION_MAX)) {
    kept[root] = adoptions[root];
  }
  return kept;
}

/**
 * Fold one of Eva's channel messages into adoption state and decide whether it
 * should be spoken.
 *
 * An @-mention adopts the thread; after that every message in it qualifies.
 * The thread's clock is refreshed by anything we see in it — tool echoes and
 * replies that settle an ask are activity too, and a live back-and-forth must
 * not be allowed to lapse. Only the *speaking* decision filters them out.
 *
 * `exchange` names the thread currently being talked through, if any; messages
 * arriving in it are part of that conversation rather than new announcements.
 *
 * `directive` is any desk command the message carries (directives.ts). It is
 * reported for every message addressed to us — including one suppressed as
 * part of a live exchange — because what it asks the face to do does not
 * depend on whether the words get spoken. `batteryRequest` is reported on the
 * same terms: hermes asking for a reading wants an answer either way, and so
 * are `lightRequest` and `brightness` (ASC-46).
 */
export function receive(
  ev: MessageEvent,
  now: number,
  botUserId: string,
  adoptions: Adoptions,
  exchange: LiveExchange | null = null,
): {
  adoptions: Adoptions;
  item: ProactiveItem | null;
  directive: DeskDirective | null;
  batteryRequest: boolean;
  lightRequest: boolean;
  brightness: BrightnessToken | null;
} {
  const raw = ev.text ?? '';
  const root = threadRoot(ev);
  const kept = prune(adoptions, now);
  if (!mentionsBot(raw, botUserId) && kept[root] === undefined) {
    return { adoptions: kept, item: null, directive: null, batteryRequest: false, lightRequest: false, brightness: null };
  }
  const directive = readDirective(raw);
  // A tool echo quoting the token is noise, not hermes asking — same rule as `[[look]]`.
  const batteryRequest = asksForBattery(raw) && !TOOL_LABEL_RE.test(raw);
  const lightRequest = asksForLight(raw) && !TOOL_LABEL_RE.test(raw);
  const brightness = TOOL_LABEL_RE.test(raw) ? null : readBrightness(raw);
  const next = cap({ ...kept, [root]: now });
  // Adoption is refreshed above either way — a suppressed message is still
  // activity, and letting the thread lapse mid-conversation would be worse.
  if (isLive(exchange, root, now)) return { adoptions: next, item: null, directive, batteryRequest, lightRequest, brightness };
  const text = announceable(raw);
  // A bare `[[look]]` has nothing to say but is still a request: the gate asks
  // in its own words. That is why this is not `isToolEcho`, which counts an
  // empty message as noise — only the emoji-label signature disqualifies it.
  const look = wantsLook(raw) && !TOOL_LABEL_RE.test(raw);
  if (text === null && !look) return { adoptions: next, item: null, directive, batteryRequest, lightRequest, brightness };
  const item: ProactiveItem = { ts: ev.ts, threadTs: root, text: text ?? '', at: now, ...(look ? { look: true as const } : {}) };
  return { adoptions: next, item, directive, batteryRequest, lightRequest, brightness };
}

/** Append, dropping the oldest at the cap and reporting it so callers can log the loss. */
export function enqueue(
  queue: ProactiveItem[],
  item: ProactiveItem,
): { queue: ProactiveItem[]; dropped: ProactiveItem | null } {
  const next = [...queue, item];
  if (next.length <= PROACTIVE_QUEUE_MAX) return { queue: next, dropped: null };
  return { queue: next.slice(1), dropped: next[0] };
}

export function dequeue(queue: ProactiveItem[]): { item: ProactiveItem | null; queue: ProactiveItem[] } {
  if (queue.length === 0) return { item: null, queue };
  return { item: queue[0], queue: queue.slice(1) };
}

/**
 * Forget a queued message. A reply can reach us before the ask that it answers
 * has registered its pending state, so a message can be queued as proactive and
 * only later turn out to settle a round — it must not then be spoken twice.
 */
export function dropTs(queue: ProactiveItem[], ts: string): ProactiveItem[] {
  return queue.filter((i) => i.ts !== ts);
}
