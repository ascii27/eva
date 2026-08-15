// The one test that talks to the real Tavily API.
//
// Everything in search.test.ts mocks fetch, which proves our *assumption* about
// the response shape rather than the shape itself. This closes that gap: it
// runs a real query and checks that what comes back is still something
// formatResults can read.
//
// Skipped unless a key is in the environment, and jest does not load .env.local
// (EXPO_PUBLIC_ vars are inlined by Metro, not by jest), so `npm test` never
// touches the network by accident. To run it:
//
//   EXPO_PUBLIC_TAVILY_API_KEY=tvly-... npx jest search.live
//
// Costs one Tavily credit per run, out of 1,000 free per month.

import { describe, expect, it } from '@jest/globals';
import { formatResults, runSearch, type TavilyResponse } from '../search';

const KEY = process.env.EXPO_PUBLIC_TAVILY_API_KEY;
const live = KEY ? describe : describe.skip;

// A question with a stable answer, so a failure means the integration broke
// rather than that the news moved.
const QUERY = 'what is the capital city of Australia';

live('Tavily, for real', () => {
  it('still returns the shape formatResults reads', async () => {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, include_answer: true, search_depth: 'basic', max_results: 5 }),
    });
    expect(res.ok).toBe(true);

    const data = (await res.json()) as TavilyResponse;
    // The two fields the formatter is built on. If either has moved, the
    // fixture in search.test.ts is a fiction and its tests prove nothing.
    expect(typeof data.answer).toBe('string');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results?.[0]).toEqual(
      expect.objectContaining({ title: expect.any(String), content: expect.any(String) }),
    );

    // eslint-disable-next-line no-console
    console.log(`\n--- what Eva would work from ---\n${formatResults(data)}\n`);
  }, 30_000);

  it('answers the question through the tool path Eva actually uses', async () => {
    const spoken = await runSearch(KEY as string, QUERY);
    expect(spoken).toContain('Canberra');
    expect(spoken).not.toContain('http'); // URLs are unlistenable and must be stripped
  }, 30_000);

  it('reports a bad key as a sentence rather than throwing', async () => {
    // The failure Eva has to be able to say out loud.
    await expect(runSearch('tvly-definitely-not-a-key', QUERY)).resolves.toMatch(/failed|could not/i);
  }, 30_000);
});
