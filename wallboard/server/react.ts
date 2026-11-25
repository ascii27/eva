// Eva reacts to chores (ASC-29). When a girl ticks a chore on the board, the
// board tells hermes, and hermes says something in Eva's bubble (the `eva`
// panel) with its eva-board-bubble skill.
//
// The board never writes the bubble itself: what to say is hermes' job, as it
// is for every other bubble. The board only decides *when* to tell, and that
// policy lives here, pure and tested; the timers and the HTTP live in
// `ChoreReactor` below with everything injected.
//
// - **Settle, then tell once.** The girls tick several chores in a row, and
//   undo a mis-tap a second later. A reaction waits until the board has been
//   quiet for SETTLE_MS (but never longer than MAX_WAIT_MS after the first
//   tick), then sends one message covering everything. An undo inside that
//   window takes its tick back out, so a mis-tap alone tells nobody.
// - **Only ticks.** An undo is not news, and a payment is money, which the
//   bubble never talks about.
// - **Not while the bubble is hidden** (21:30–06:30, the board's night view):
//   a reaction nobody sees until morning is a stale one.
// - **Fire and forget.** A hermes run takes seconds to minutes and can fail;
//   nothing on the board waits for it, and a lost reaction is not retried. The
//   next tick gets its own.

import type { LogEvent } from './state.ts';

/** Quiet time after the last tick before telling hermes. */
export const SETTLE_MS = 90_000;
/** A steady stream of ticks still gets a reaction this long after the first. */
export const MAX_WAIT_MS = 5 * 60_000;
/** How long a hermes run may take before the board stops waiting for it. */
export const SEND_TIMEOUT_MS = 5 * 60_000;

/** One completion waiting to be told. */
export interface Tick {
  eventId: string;
  choreId: string;
  title: string;
  who: string;
  at: number;
}

/** The board's chores as `view` shows them: today's, done or not. */
export interface TodayChore {
  title: string;
  who: string | null;
  done: boolean;
}

/** Fold one log event into what is waiting: a tick adds, an undo of a waiting tick removes. */
export function noteEvent(pending: Tick[], e: LogEvent): Tick[] {
  if (e.type === 'done') return [...pending, { eventId: e.id, choreId: e.choreId, title: e.title, who: e.who, at: e.at }];
  if (e.type === 'undone') return pending.filter((t) => t.eventId !== e.cancels);
  return pending;
}

/** The bubble is hidden from 21:30 to 06:30 Tokyo time (README, `eva` panel). */
export function bubbleHidden(at: number): boolean {
  const d = new Date(at + 9 * 3_600_000);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return min >= 21 * 60 + 30 || min < 6 * 60 + 30;
}

const NAMES: Record<string, string> = { mariko: 'Mariko', sarina: 'Sarina', anyone: 'Someone' };
const nameOf = (who: string) => NAMES[who] ?? who.charAt(0).toUpperCase() + who.slice(1);

function hhmm(at: number): string {
  const d = new Date(at + 9 * 3_600_000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "a", "a and b", "a, b and c". */
function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * What hermes is told. Facts only — who ticked what, and where each person's
 * day now stands — plus which skill to use; the skill says what makes a good
 * reaction. No amounts: the bubble never mentions money.
 */
export function reactionMessage(ticks: Tick[], today: TodayChore[], at: number): string {
  const lines = ['The family just ticked chores on the kitchen board.', ''];
  const byWho = new Map<string, Tick[]>();
  for (const t of ticks) byWho.set(t.who, [...(byWho.get(t.who) ?? []), t]);
  for (const [who, ts] of byWho) lines.push(`- ${nameOf(who)} ticked ${list(ts.map((t) => `"${t.title}"`))} (at ${hhmm(ts[ts.length - 1].at)}).`);

  lines.push('', 'Where today stands now:');
  const people = [...new Set(today.map((c) => c.who ?? 'anyone'))];
  for (const who of people) {
    const mine = today.filter((c) => (c.who ?? 'anyone') === who);
    const left = mine.filter((c) => !c.done);
    lines.push(left.length === 0
      ? `- ${nameOf(who)}: all ${mine.length} done.`
      : `- ${nameOf(who)}: ${mine.length - left.length} of ${mine.length} done; still to do ${list(left.map((c) => `"${c.title}"`))}.`);
  }
  if (today.length > 0 && today.every((c) => c.done)) lines.push('', 'Every chore on the board is done for today.');

  lines.push('', `It is ${hhmm(at)} in Tokyo. React in Eva's bubble on the kitchen board, using the eva-board-bubble skill ("Reacting to chores"). Reply in one line with what you pushed, or why you pushed nothing.`);
  return lines.join('\n');
}

// ---- the effectful shell ---------------------------------------------------

export interface ReactorDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  /** Today's chores, read when the reaction goes out (not when the tick came in). */
  today: () => TodayChore[];
  /** Tells hermes. Resolves when hermes is done, or rejects; neither is waited on by the board. */
  send: (message: string) => Promise<void>;
  log: (line: string) => void;
}

export class ChoreReactor {
  private pending: Tick[] = [];
  private timer: unknown = null;
  private inFlight = false;
  private d: ReactorDeps;

  constructor(d: ReactorDeps) {
    this.d = d;
  }

  /** Every new log event, in order. */
  onEvent(e: LogEvent): void {
    const before = this.pending.length;
    this.pending = noteEvent(this.pending, e);
    if (this.pending.length === before && e.type !== 'done') return;
    this.arm();
  }

  private arm(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
    if (this.pending.length === 0) return;
    const deadline = this.pending[0].at + MAX_WAIT_MS;
    this.timer = this.d.setTimer(() => this.fire(), Math.max(0, Math.min(SETTLE_MS, deadline - this.d.now())));
  }

  private fire(): void {
    this.timer = null;
    // One reaction at a time; ticks that land meanwhile go out after it.
    if (this.inFlight) return;
    const ticks = this.pending;
    this.pending = [];
    if (ticks.length === 0) return;
    const at = this.d.now();
    if (bubbleHidden(at)) {
      this.d.log(`[react] ${ticks.length} tick(s) at night, not told`);
      return;
    }
    this.inFlight = true;
    this.d.log(`[react] telling hermes about ${ticks.length} tick(s)`);
    this.d.send(reactionMessage(ticks, this.d.today(), at))
      .then(() => this.d.log('[react] hermes done'))
      .catch((e) => this.d.log(`[react] hermes failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.inFlight = false;
        if (this.pending.length > 0) this.arm();
      });
  }
}

export interface HermesApi {
  /** hermes' OpenAI-compatible base, ending in /v1 (HERMES_AGENT_URL). */
  url: string;
  key: string;
  model: string;
}

/**
 * hermes' API server is OpenAI-compatible, as on the desk. Its own session id
 * per day keeps the board's reactions out of Michael's transcript with hermes,
 * while letting one day's reactions see each other.
 */
export async function sendToHermes(api: HermesApi, message: string, at: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const day = new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
  const res = await fetchFn(`${api.url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.key}`,
      'X-Hermes-Session-Key': 'eva-board',
      'X-Hermes-Session-Id': `eva-board-chores-${day}`,
    },
    body: JSON.stringify({ model: api.model, stream: false, messages: [{ role: 'user', content: message }] }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.text();
}
