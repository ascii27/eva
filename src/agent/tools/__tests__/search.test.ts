import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { formatResults, runSearch, SNIPPET_CHARS } from '../search';

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

/**
 * A response in the shape the live API actually returns, per Tavily's endpoint
 * reference — including the fields we do not read (score, id, response_time,
 * request_id). Tolerating them is the point: they are what a real call brings.
 */
const LIVE_SHAPED = {
  query: 'capital of australia',
  answer: 'Canberra is the capital of Australia.',
  results: [
    {
      title: 'Canberra — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Canberra',
      content: 'Canberra is the capital city of Australia.',
      score: 0.97,
      id: 'r1',
      favicon: 'https://en.wikipedia.org/favicon.ico',
    },
  ],
  images: [],
  response_time: 1.42,
  request_id: 'req_abc123',
};

describe('runSearch', () => {
  const original = global.fetch;
  let calls: { url: string; init: RequestInit }[] = [];

  const respondWith = (status: number, body: unknown) => {
    (global as { fetch: unknown }).fetch = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
    };
  };

  const body = () => JSON.parse(calls[0].init.body as string);

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    (global as { fetch: unknown }).fetch = original;
  });

  it('authenticates with a bearer token', async () => {
    respondWith(200, LIVE_SHAPED);
    await runSearch('tvly-secret', 'capital of australia');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-secret');
  });

  it('asks for the synthesized answer, which is what makes the reply sayable', async () => {
    respondWith(200, LIVE_SHAPED);
    await runSearch('tvly-secret', 'capital of australia');
    expect(body().include_answer).toBe(true);
    expect(body().query).toBe('capital of australia');
  });

  it('reads a live-shaped response, ignoring the fields it does not use', async () => {
    respondWith(200, LIVE_SHAPED);
    expect(await runSearch('tvly-secret', 'capital of australia')).toContain('Canberra is the capital');
  });

  it('passes the abort signal through, so a superseded round stops the search', async () => {
    respondWith(200, LIVE_SHAPED);
    const controller = new AbortController();
    await runSearch('tvly-secret', 'x', controller.signal);
    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it('reports a rejected key as a sentence rather than throwing', async () => {
    // A tool that throws takes down a round that is already speaking aloud.
    respondWith(401, { detail: 'unauthorized' });
    await expect(runSearch('tvly-wrong', 'x')).resolves.toContain('401');
  });

  it('reports a network failure as a sentence rather than throwing', async () => {
    (global as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'));
    await expect(runSearch('tvly-secret', 'x')).resolves.toContain('offline');
  });

  it('reports unreadable JSON as a sentence rather than throwing', async () => {
    (global as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });
    await expect(runSearch('tvly-secret', 'x')).resolves.toMatch(/could not|failed/i);
  });
});
