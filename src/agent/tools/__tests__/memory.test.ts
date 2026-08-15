import { describe, expect, it } from '@jest/globals';
import { type MemoryRecord, searchMemories } from '../memory';

const rec = (id: string, endedAt: number, summary: string): MemoryRecord => ({ id, endedAt, summary });

describe('searchMemories', () => {
  it('finds a record whose summary mentions the query terms', () => {
    const records = [rec('a', 1, 'Michael prefers dark roast coffee.'), rec('b', 2, 'Discussed the Q3 roadmap.')];
    expect(searchMemories(records, 'roadmap', 5).map((r) => r.id)).toEqual(['b']);
  });

  it('ranks a record matching more terms above one matching fewer', () => {
    const records = [
      rec('one-term', 2, 'Talked about the roadmap.'),
      rec('two-terms', 1, 'Talked about the roadmap and the hiring plan.'),
    ];
    expect(searchMemories(records, 'roadmap hiring', 5).map((r) => r.id)).toEqual(['two-terms', 'one-term']);
  });

  it('breaks a scoring tie by recency', () => {
    const records = [rec('older', 100, 'Roadmap talk.'), rec('newer', 200, 'Roadmap talk.')];
    expect(searchMemories(records, 'roadmap', 5).map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('ignores case on both sides', () => {
    expect(searchMemories([rec('a', 1, 'The ROADMAP slipped.')], 'Roadmap', 5)).toHaveLength(1);
  });

  it('matches a term inside a longer word, since speech rarely lands on the exact form', () => {
    expect(searchMemories([rec('a', 1, 'The deployment slipped.')], 'deploy', 5)).toHaveLength(1);
  });

  it('ignores stopwords, which would otherwise match every record', () => {
    // "what did we say about the …" is how the question actually arrives.
    const records = [rec('a', 1, 'Coffee preferences.'), rec('b', 2, 'The roadmap slipped.')];
    expect(searchMemories(records, 'what did we say about the roadmap', 5).map((r) => r.id)).toEqual(['b']);
  });

  it('returns nothing when a query matches nothing', () => {
    expect(searchMemories([rec('a', 1, 'Coffee preferences.')], 'quarterly budget', 5)).toEqual([]);
  });

  it('returns nothing for an empty corpus', () => {
    expect(searchMemories([], 'anything', 5)).toEqual([]);
  });

  it('returns nothing for a query that is nothing but stopwords', () => {
    // Better to say "I didn't find anything" than to return the whole archive.
    expect(searchMemories([rec('a', 1, 'Coffee preferences.')], 'what about the', 5)).toEqual([]);
  });

  it('respects the limit', () => {
    const records = [1, 2, 3, 4].map((n) => rec(`r${n}`, n, 'Roadmap talk.'));
    expect(searchMemories(records, 'roadmap', 2)).toHaveLength(2);
  });

  it('scores each query term once, so repeating a word cannot inflate a match', () => {
    const records = [
      rec('repeat', 2, 'Roadmap, roadmap, roadmap.'),
      rec('breadth', 1, 'Roadmap and hiring.'),
    ];
    expect(searchMemories(records, 'roadmap hiring', 5).map((r) => r.id)).toEqual(['breadth', 'repeat']);
  });
});
