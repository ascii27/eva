import { describe, expect, it } from '@jest/globals';
import {
  appendTurn,
  applyCompaction,
  buildRequest,
  estimateTokens,
  historyTokens,
  HISTORY_BUDGET_TOKENS,
  isGap,
  KEEP_RECENT_TURNS,
  newSession,
  planCompaction,
  SESSION_GAP_MS,
  sessionId,
  type Session,
  type Turn,
} from '../history';

const NOW = 1_770_000_000_000; // fixed clock; nothing here reads Date.now()
const PERSONA = 'You are Eva.';

/** n alternating turns starting with the user, each `chars` long. */
function turns(n: number, chars = 20): Turn[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `${i}`.padEnd(chars, 'x'),
  }));
}

function session(over: Partial<Session> = {}): Session {
  return { ...newSession(NOW), ...over };
}

describe('estimateTokens', () => {
  it('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('rounds a partial token up, so budgets are never underestimated', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('sessionId', () => {
  it('is a filesystem-safe, lexicographically sortable stamp', () => {
    expect(sessionId(Date.UTC(2026, 7, 15, 14, 22, 1))).toBe('2026-08-15T14-22-01');
  });

  it('sorts lexicographically in chronological order', () => {
    const early = sessionId(Date.UTC(2026, 7, 15, 9, 5, 0));
    const late = sessionId(Date.UTC(2026, 7, 15, 14, 22, 1));
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe('newSession', () => {
  it('starts empty, with no summary, stamped at now', () => {
    const s = newSession(NOW);
    expect(s.turns).toEqual([]);
    expect(s.summary).toBeNull();
    expect(s.startedAt).toBe(NOW);
    expect(s.lastAt).toBe(NOW);
  });
});

describe('isGap', () => {
  it('is false while the conversation is still warm', () => {
    const s = session({ turns: turns(2), lastAt: NOW });
    expect(isGap(s, NOW + SESSION_GAP_MS - 1)).toBe(false);
  });

  it('is true once the gap has fully elapsed', () => {
    const s = session({ turns: turns(2), lastAt: NOW });
    expect(isGap(s, NOW + SESSION_GAP_MS)).toBe(true);
  });

  it('is false for an empty session however old — there is nothing to archive', () => {
    const s = session({ turns: [], lastAt: NOW });
    expect(isGap(s, NOW + SESSION_GAP_MS * 100)).toBe(false);
  });
});

describe('appendTurn', () => {
  it('appends and refreshes lastAt', () => {
    const s = appendTurn(session(), { role: 'user', content: 'hi' }, NOW + 500);
    expect(s.turns).toEqual([{ role: 'user', content: 'hi' }]);
    expect(s.lastAt).toBe(NOW + 500);
  });

  it('does not mutate the input session', () => {
    const before = session();
    appendTurn(before, { role: 'user', content: 'hi' }, NOW + 500);
    expect(before.turns).toEqual([]);
    expect(before.lastAt).toBe(NOW);
  });

  it('leaves startedAt and summary alone', () => {
    const before = session({ summary: 'earlier stuff' });
    const after = appendTurn(before, { role: 'user', content: 'hi' }, NOW + 500);
    expect(after.startedAt).toBe(NOW);
    expect(after.summary).toBe('earlier stuff');
  });
});

describe('historyTokens', () => {
  it('counts the running summary alongside the turns', () => {
    const withoutSummary = historyTokens(session({ turns: turns(2) }));
    const withSummary = historyTokens(session({ turns: turns(2), summary: 'x'.repeat(400) }));
    expect(withSummary).toBe(withoutSummary + 100);
  });
});

describe('planCompaction', () => {
  /** Enough turns to blow the budget: each turn ~1000 chars = 250 tokens. */
  const fat = (n: number) => turns(n, 1000);

  it('returns null while history fits the budget', () => {
    expect(planCompaction(session({ turns: turns(4) }))).toBeNull();
  });

  it('plans a fold once history exceeds the budget', () => {
    const s = session({ turns: fat(20) });
    expect(historyTokens(s)).toBeGreaterThan(HISTORY_BUDGET_TOKENS);
    const plan = planCompaction(s);
    expect(plan).not.toBeNull();
    expect(plan!.fold.length).toBeGreaterThan(0);
  });

  it('always keeps at least the most recent turns verbatim', () => {
    const plan = planCompaction(session({ turns: fat(20) }))!;
    expect(plan.keep.length).toBeGreaterThanOrEqual(KEEP_RECENT_TURNS);
    expect(plan.keep).toEqual(fat(20).slice(-plan.keep.length));
  });

  it('folds and keeps exactly the whole history between them', () => {
    const all = fat(20);
    const plan = planCompaction(session({ turns: all }))!;
    expect([...plan.fold, ...plan.keep]).toEqual(all);
    expect(plan.foldCount).toBe(plan.fold.length);
  });

  it('never leaves an assistant reply as the first kept turn', () => {
    // A stray extra user turn (an errored round) shifts the alternation, so a
    // naive slice at length - KEEP would orphan an assistant reply.
    const odd: Turn[] = [{ role: 'user', content: 'x'.repeat(1000) }, ...fat(20)];
    const plan = planCompaction(session({ turns: odd }))!;
    expect(plan.keep[0].role).toBe('user');
  });

  it('returns null when even the kept turns alone exceed the budget', () => {
    // Nothing is foldable without breaking the keep-recent promise.
    const s = session({ turns: turns(KEEP_RECENT_TURNS, 4000) });
    expect(historyTokens(s)).toBeGreaterThan(HISTORY_BUDGET_TOKENS);
    expect(planCompaction(s)).toBeNull();
  });

  it('does not mutate the session', () => {
    const s = session({ turns: fat(20) });
    planCompaction(s);
    expect(s.turns).toHaveLength(20);
  });
});

describe('applyCompaction', () => {
  it('replaces the folded turns with the new summary', () => {
    const s = session({ turns: turns(10), summary: null });
    const after = applyCompaction(s, 4, 'they discussed the roadmap');
    expect(after.summary).toBe('they discussed the roadmap');
    expect(after.turns).toEqual(turns(10).slice(4));
  });

  it('replaces rather than accumulates the previous summary, so it stays bounded', () => {
    const s = session({ turns: turns(10), summary: 'the old summary' });
    expect(applyCompaction(s, 4, 'the new summary').summary).toBe('the new summary');
  });

  it('keeps turns that arrived while the summary was being generated', () => {
    // The round that triggered compaction returns before the summarizer does,
    // so the user can speak again mid-flight. Dropping by count (not by
    // replacing with plan.keep) is what makes that safe.
    const planned = session({ turns: turns(20, 1000) });
    const plan = planCompaction(planned)!;
    const grew = appendTurn(planned, { role: 'user', content: 'and one more' }, NOW + 1);
    const after = applyCompaction(grew, plan.foldCount, 'summary');
    expect(after.turns[after.turns.length - 1]).toEqual({ role: 'user', content: 'and one more' });
    expect(after.turns).toHaveLength(grew.turns.length - plan.foldCount);
  });

  it('does not mutate the input session', () => {
    const s = session({ turns: turns(10) });
    applyCompaction(s, 4, 'summary');
    expect(s.turns).toHaveLength(10);
    expect(s.summary).toBeNull();
  });
});

describe('buildRequest', () => {
  it('leads with a single system message carrying the persona', () => {
    const msgs = buildRequest(PERSONA, [], session({ turns: turns(2) }));
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(PERSONA);
  });

  it('puts the turns last, in order', () => {
    const msgs = buildRequest(PERSONA, [], session({ turns: turns(4) }));
    expect(msgs.slice(-4)).toEqual(turns(4));
  });

  it('omits the memory block entirely when there is nothing remembered', () => {
    const msgs = buildRequest(PERSONA, [], session());
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe(PERSONA);
  });

  it('folds memories into the leading system message, so the prefix stays cacheable', () => {
    const msgs = buildRequest(PERSONA, ['he prefers mornings', 'the demo is Thursday'], session({ turns: turns(2) }));
    expect(msgs[0].content).toContain('he prefers mornings');
    expect(msgs[0].content).toContain('the demo is Thursday');
    // Still exactly one leading system message: persona + memory are one block.
    expect(msgs.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('carries the running summary as a separate system message after the persona', () => {
    const msgs = buildRequest(PERSONA, ['a memory'], session({ turns: turns(2), summary: 'they talked shop' }));
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('a memory');
    expect(msgs[1].role).toBe('system');
    expect(msgs[1].content).toContain('they talked shop');
    expect(msgs.slice(2)).toEqual(turns(2));
  });

  it('keeps the persona message byte-identical whether or not a summary exists', () => {
    // The whole point of the split: a compaction rewrites message 2 without
    // invalidating the cached prefix that is message 1.
    const a = buildRequest(PERSONA, ['a memory'], session({ turns: turns(2) }));
    const b = buildRequest(PERSONA, ['a memory'], session({ turns: turns(2), summary: 'new summary' }));
    expect(a[0].content).toBe(b[0].content);
  });

  it('keeps the persona message stable as turns accumulate', () => {
    const a = buildRequest(PERSONA, ['a memory'], session({ turns: turns(2) }));
    const b = buildRequest(PERSONA, ['a memory'], session({ turns: turns(8) }));
    expect(a[0].content).toBe(b[0].content);
  });
});
