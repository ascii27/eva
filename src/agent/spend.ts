// Running token spend, for reading burn rate off the console.
//
// Pure and unit-tested, like every other policy module here; the hooks own the
// clock and the printing. Kept in agent/ rather than realtime/ because both
// brains report through it, and the only way to know whether the realtime
// session costs more than the chat path is to read the two in the same units.
//
// Why this exists at all: a realtime session is charged the whole conversation
// on every response, and its server-side conversation grows to roughly 28.6k
// tokens before the server truncates — where the chat path's compaction caps
// what gets re-sent at HISTORY_BUDGET_TOKENS (3k). So input tokens per round
// are expected to climb across a long conversation, and the question this
// answers is how steeply. Cumulative counts and a rate make that visible in a
// way a per-round line on its own does not.

import type { ChatUsage } from './openai';

export interface Spend {
  rounds: number;
  /** Laps, not rounds: a tool round is billed once per response. */
  responses: number;
  prompt: number;
  cached: number;
  completion: number;
  /** When counting started, for the rate. */
  since: number;
}

export function emptySpend(now: number): Spend {
  return { rounds: 0, responses: 0, prompt: 0, cached: 0, completion: 0, since: now };
}

/** Fold in one response's usage. `endsRound` marks the last lap of a round. */
export function addSpend(spend: Spend, usage: ChatUsage | null, endsRound: boolean): Spend {
  return {
    ...spend,
    rounds: spend.rounds + (endsRound ? 1 : 0),
    responses: spend.responses + (usage ? 1 : 0),
    prompt: spend.prompt + (usage?.promptTokens ?? 0),
    cached: spend.cached + (usage?.cachedTokens ?? 0),
    completion: spend.completion + (usage?.completionTokens ?? 0),
  };
}

export function totalTokens(spend: Spend): number {
  return spend.prompt + spend.completion;
}

function group(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * The cumulative line, e.g.
 * `3 rounds · 5 responses · 4,102 in (2,560 cached, 62%) · 267 out · 2,190 tok/min`
 *
 * The cached percentage is the one number worth watching beside the rate:
 * realtime's prefix caching is best-effort rather than guaranteed, and a
 * conversation whose cache hit rate collapses is being re-billed in full for
 * every turn, which is exactly the failure the growth ceiling would hide.
 *
 * Deliberately no dollar figure. The per-token prices for the realtime minis
 * are published, but this reports whichever model is actually selected, and
 * quoting a rate for a model whose price has not been checked would turn a
 * measurement into a guess. Tokens are the honest unit; the price table is a
 * multiplication away.
 */
export function formatSpend(spend: Spend, now: number): string {
  const elapsed = Math.max(0, now - spend.since);
  const total = totalTokens(spend);
  // Under a second of wall clock, a rate is division by noise.
  const rate = elapsed >= 1_000 ? `${group(Math.round((total / elapsed) * 60_000))} tok/min` : 'rate —';
  const cachedPct = spend.prompt > 0 ? `, ${Math.round((spend.cached / spend.prompt) * 100)}%` : '';
  return (
    `${spend.rounds} round${spend.rounds === 1 ? '' : 's'} · ${spend.responses} response${spend.responses === 1 ? '' : 's'} · ` +
    `${group(spend.prompt)} in (${group(spend.cached)} cached${cachedPct}) · ${group(spend.completion)} out · ${rate}`
  );
}
