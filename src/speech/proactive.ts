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
import { isToolEcho, speakableFromMrkdwn } from '../slack/sanitize';

/** Backlog cap. Beyond this the oldest is dropped — it stays in the transcript. */
export const PROACTIVE_QUEUE_MAX = 5;
/** A thread stops speaking after this much silence; any Eva message refreshes it. */
export const ADOPTION_IDLE_MS = 30 * 60_000;
/** Ceiling on tracked threads, newest kept. */
export const ADOPTION_MAX = 20;

export interface ProactiveItem {
  /** Slack ts of the message — the identity used to drop it if it settles an ask. */
  ts: string;
  /** Thread root to answer into. */
  threadTs: string;
  /** Already flattened for speech. */
  text: string;
  at: number;
}

/** Adopted thread root → last-activity epoch ms. */
export type Adoptions = Record<string, number>;

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
 */
export function receive(
  ev: MessageEvent,
  now: number,
  botUserId: string,
  adoptions: Adoptions,
): { adoptions: Adoptions; item: ProactiveItem | null } {
  const raw = ev.text ?? '';
  const root = threadRoot(ev);
  const live = prune(adoptions, now);
  if (!mentionsBot(raw, botUserId) && live[root] === undefined) return { adoptions: live, item: null };
  const next = cap({ ...live, [root]: now });
  const text = announceable(raw);
  return { adoptions: next, item: text === null ? null : { ts: ev.ts, threadTs: root, text, at: now } };
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
