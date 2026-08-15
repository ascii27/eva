import { describe, expect, it } from '@jest/globals';
import { formatResults, SNIPPET_CHARS } from '../search';

/**
 * Shaped after a real Tavily response. Trimmed to the fields the formatter
 * reads — the live API also returns scores, raw content and timings.
 */
const FIXTURE = {
  query: 'who won the 2026 world cup',
  answer: 'Argentina won the 2026 FIFA World Cup, beating France 3-1 in the final.',
  results: [
    {
      title: 'FIFA World Cup 2026 Final — Report',
      url: 'https://example.com/final-report',
      content: 'Argentina lifted the trophy after a 3-1 win over France at MetLife Stadium.',
    },
    {
      title: 'World Cup 2026: how Argentina did it',
      url: 'https://example.com/analysis',
      content: 'A tactical breakdown of the winning campaign.',
    },
    {
      title: 'Every World Cup winner',
      url: 'https://example.com/history',
      content: 'A full list of champions since 1930.',
    },
    {
      title: 'Ticket refunds',
      url: 'https://example.com/tickets',
      content: 'Unrelated administrative notice.',
    },
  ],
};

describe('formatResults', () => {
  it('leads with the synthesized answer', () => {
    expect(formatResults(FIXTURE).startsWith(FIXTURE.answer)).toBe(true);
  });

  it('includes supporting snippets behind the answer', () => {
    expect(formatResults(FIXTURE)).toContain('MetLife Stadium');
  });

  it('caps the snippets, because the whole thing is read aloud', () => {
    expect(formatResults(FIXTURE)).not.toContain('Unrelated administrative notice');
  });

  it('omits URLs, which are unlistenable', () => {
    expect(formatResults(FIXTURE)).not.toContain('https://');
    expect(formatResults(FIXTURE)).not.toContain('example.com');
  });

  it('falls back to the snippets when there is no answer field', () => {
    const out = formatResults({ results: FIXTURE.results });
    expect(out).toContain('MetLife Stadium');
    expect(out).not.toContain('undefined');
  });

  it('returns the answer alone when there are no results', () => {
    expect(formatResults({ answer: 'Just the answer.', results: [] })).toBe('Just the answer.');
  });

  it('says so plainly when the search found nothing at all', () => {
    expect(formatResults({ results: [] }).toLowerCase()).toContain('nothing');
  });

  it('says so plainly when the response has no fields at all', () => {
    expect(formatResults({}).toLowerCase()).toContain('nothing');
  });

  it('truncates a long snippet rather than reading an essay aloud', () => {
    const long = 'x'.repeat(SNIPPET_CHARS * 3);
    const out = formatResults({ results: [{ title: 'Long', content: long }] });
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(SNIPPET_CHARS * 2);
  });

  it('skips a result with no usable content instead of emitting a blank line', () => {
    const out = formatResults({ results: [{ title: 'Empty', content: '   ' }, { title: 'Real', content: 'Useful.' }] });
    expect(out).toContain('Useful.');
    expect(out).not.toContain('Empty');
  });

  it('handles a result with content but no title', () => {
    expect(formatResults({ results: [{ content: 'Untitled but useful.' }] })).toContain('Untitled but useful.');
  });
});
