import { describe, expect, it } from '@jest/globals';
import { addSpend, emptySpend, formatSpend, totalTokens } from '../spend';

const usage = (prompt: number, cached: number, completion: number) => ({
  promptTokens: prompt,
  cachedTokens: cached,
  completionTokens: completion,
});

describe('addSpend', () => {
  it('counts a response per lap and a round only when the round ends', () => {
    let s = emptySpend(0);
    s = addSpend(s, usage(400, 0, 20), false); // preamble + tool call
    s = addSpend(s, usage(600, 384, 40), true); // the answer
    expect(s.responses).toBe(2);
    expect(s.rounds).toBe(1);
    expect(s.prompt).toBe(1_000);
    expect(s.cached).toBe(384);
    expect(s.completion).toBe(60);
  });

  it('still closes the round when usage is missing', () => {
    const s = addSpend(emptySpend(0), null, true);
    expect(s.rounds).toBe(1);
    expect(s.responses).toBe(0);
    expect(totalTokens(s)).toBe(0);
  });
});

describe('formatSpend', () => {
  it('reports a rate over elapsed wall clock', () => {
    let s = emptySpend(0);
    s = addSpend(s, usage(1_000, 0, 200), true);
    // 1,200 tokens in 30s is 2,400/min
    expect(formatSpend(s, 30_000)).toContain('2,400 tok/min');
  });

  it('refuses to divide by noise before a second has passed', () => {
    const s = addSpend(emptySpend(0), usage(500, 0, 10), true);
    expect(formatSpend(s, 100)).toContain('rate —');
  });

  it('shows the cache hit rate, which is what a growing conversation costs', () => {
    const s = addSpend(emptySpend(0), usage(1_000, 750, 50), true);
    expect(formatSpend(s, 60_000)).toContain('1,000 in (750 cached, 75%)');
  });

  it('omits a percentage rather than dividing by zero on the first turn', () => {
    const s = addSpend(emptySpend(0), usage(0, 0, 0), true);
    expect(formatSpend(s, 60_000)).toContain('0 in (0 cached)');
  });

  it('pluralises honestly', () => {
    const one = addSpend(emptySpend(0), usage(10, 0, 1), true);
    expect(formatSpend(one, 60_000)).toContain('1 round · 1 response ');
  });
});
