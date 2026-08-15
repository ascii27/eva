// Conversation history policy for the local agent loop — no React, no I/O,
// unit-tested.
//
// The Slack path never needed this: the channel *was* the conversation state.
// Talking to the model directly means we own it, which means owning three
// decisions — when a silence ends a session, when history has grown expensive
// enough to fold into a summary, and how the request is laid out so OpenAI's
// automatic prompt caching can actually hit.
//
// Caching drives the message layout in buildRequest. Caching matches on the
// longest *stable prefix*, so the persona and remembered summaries — which do
// not change for the life of a session — go in one leading system message, and
// the running compaction summary, which is rewritten each time compaction
// fires, goes in a second one after it. That way a compaction invalidates only
// what follows it, not the persona block.

export type Role = 'user' | 'assistant';

export interface Turn {
  role: Role;
  content: string;
}

export interface Session {
  /** Filesystem-safe stamp of startedAt; doubles as the archive filename. */
  id: string;
  startedAt: number;
  /** Last turn's timestamp — the clock the session-gap decision reads. */
  lastAt: number;
  turns: Turn[];
  /** Running summary of turns already folded away, or null before any fold. */
  summary: string | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompactionPlan {
  /** Oldest turns to summarize away. */
  fold: Turn[];
  /** Turns to keep verbatim. */
  keep: Turn[];
  /**
   * fold.length, kept separately because applyCompaction drops by count rather
   * than by replacing with `keep` — see the race note there.
   */
  foldCount: number;
}

/** A silence this long ends the session and sends it to memory. */
export const SESSION_GAP_MS = 30 * 60_000;

/**
 * Fold history above this. Deliberately generous: every compaction rewrites the
 * summary message and invalidates the cached prefix after it, so rare-and-large
 * beats frequent-and-small. Compaction is the primary cost control; caching is
 * a discount on top of it.
 */
export const HISTORY_BUDGET_TOKENS = 3_000;

/** Never fold these, however far over budget we are. */
export const KEEP_RECENT_TURNS = 6;

/** How many archived session summaries to carry as memory. */
export const MEMORY_LIMIT = 5;

// The qualifier is not decoration. These notes are written by a past version of
// Eva and outlive the capabilities she had at the time, so a note recording
// what she could not do will still be sitting here after she can — and it wins,
// because a remembered fact reads as more specific than an instruction. The
// summarizers are told not to write such notes (see persona.ts); this is the
// second line of defence for the ones already on disk.
const MEMORY_HEADER =
  'What you remember from earlier conversations. These are notes on what was said at the time, not a description of what you can do now — where a note disagrees with the tools you have been given, the tools are right:';
const SUMMARY_HEADER = 'Earlier in this conversation:';

/**
 * Rough token count — four characters per token, rounded up. Deliberately an
 * estimate: this only picks the moment to compact, and paying for a real
 * tokenizer (or a /v1/tokens round trip) to place that threshold would cost
 * more than being slightly off.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Second-resolution ISO stamp with the colons swapped out, so it is safe as a
 * filename on every platform and still sorts lexicographically in
 * chronological order — which is what lets the store list memory by name.
 */
export function sessionId(startedAt: number): string {
  return new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, '-');
}

export function newSession(now: number): Session {
  return { id: sessionId(now), startedAt: now, lastAt: now, turns: [], summary: null };
}

/**
 * True when the conversation has been quiet long enough to close out. An empty
 * session is never a gap: there is nothing to summarize, so it just keeps
 * waiting rather than churning out empty archives.
 */
export function isGap(session: Session, now: number): boolean {
  if (session.turns.length === 0) return false;
  return now - session.lastAt >= SESSION_GAP_MS;
}

export function appendTurn(session: Session, turn: Turn, now: number): Session {
  return { ...session, turns: [...session.turns, turn], lastAt: now };
}

export function historyTokens(session: Session): number {
  let total = session.summary ? estimateTokens(session.summary) : 0;
  for (const t of session.turns) total += estimateTokens(t.content);
  return total;
}

/**
 * What to fold, or null when history still fits — and also null when the turns
 * we promised to keep are themselves over budget, since folding into them would
 * break that promise for no benefit. Folds everything foldable rather than just
 * enough to fit, so compaction fires rarely.
 */
export function planCompaction(session: Session): CompactionPlan | null {
  if (historyTokens(session) <= HISTORY_BUDGET_TOKENS) return null;

  let foldCount = session.turns.length - KEEP_RECENT_TURNS;
  // An assistant reply must never lead the kept block — its question would be
  // gone, leaving an answer to nothing. Keep the pair together by folding one
  // fewer turn.
  if (foldCount > 0 && session.turns[foldCount].role === 'assistant') foldCount -= 1;
  if (foldCount <= 0) return null;

  return {
    fold: session.turns.slice(0, foldCount),
    keep: session.turns.slice(foldCount),
    foldCount,
  };
}

/**
 * Drop the folded turns and install the new summary.
 *
 * Drops by count rather than assigning the plan's `keep`: summarizing is an API
 * call that happens off the round's critical path, so the user can speak again
 * before it returns. Slicing the *current* turns by foldCount preserves
 * whatever arrived meanwhile; assigning `keep` would silently discard it.
 *
 * `summary` replaces the previous one rather than appending to it — the
 * summarizer is given the old summary as input, so the string it returns is
 * already the whole story and stays bounded.
 */
export function applyCompaction(session: Session, foldCount: number, summary: string): Session {
  return { ...session, turns: session.turns.slice(foldCount), summary };
}

/**
 * The request message list. See the caching note at the top of this file for
 * why persona+memory and the running summary are separate messages.
 *
 * `memories` is passed already trimmed (the store reads MEMORY_LIMIT of them);
 * this just lays them out.
 */
export function buildRequest(persona: string, memories: string[], session: Session): ChatMessage[] {
  const prefix = memories.length
    ? `${persona}\n\n${MEMORY_HEADER}\n${memories.map((m) => `- ${m}`).join('\n')}`
    : persona;

  const messages: ChatMessage[] = [{ role: 'system', content: prefix }];
  if (session.summary) messages.push({ role: 'system', content: `${SUMMARY_HEADER} ${session.summary}` });
  return [...messages, ...session.turns];
}
