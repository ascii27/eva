import { describe, expect, it } from '@jest/globals';
import { emptySse, parseSse } from '../sse';

/** One OpenAI content frame. */
const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('parseSse', () => {
  it('reads a single complete frame', () => {
    const { chunk } = parseSse(emptySse(), frame('Hello'));
    expect(chunk.deltas).toEqual(['Hello']);
    expect(chunk.done).toBe(false);
  });

  it('reads several frames arriving in one chunk', () => {
    const { chunk } = parseSse(emptySse(), frame('Hello') + frame(' there'));
    expect(chunk.deltas).toEqual(['Hello', ' there']);
  });

  it('carries a frame split mid-line across two chunks', () => {
    const whole = frame('Hello');
    const cut = Math.floor(whole.length / 2);
    const first = parseSse(emptySse(), whole.slice(0, cut));
    expect(first.chunk.deltas).toEqual([]);
    const second = parseSse(first.state, whole.slice(cut));
    expect(second.chunk.deltas).toEqual(['Hello']);
  });

  it('carries a partial frame while still emitting the complete one before it', () => {
    const partial = frame('later').slice(0, 12);
    const { state, chunk } = parseSse(emptySse(), frame('now') + partial);
    expect(chunk.deltas).toEqual(['now']);
    expect(state.buffer).toBe(partial);
  });

  it('flags [DONE]', () => {
    const { chunk } = parseSse(emptySse(), 'data: [DONE]\n\n');
    expect(chunk.done).toBe(true);
    expect(chunk.deltas).toEqual([]);
  });

  it('reads the trailing usage-only chunk', () => {
    const raw = `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 412, completion_tokens: 89, prompt_tokens_details: { cached_tokens: 256 } },
    })}\n\n`;
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.usage).toEqual({ promptTokens: 412, cachedTokens: 256, completionTokens: 89 });
    expect(chunk.deltas).toEqual([]);
  });

  it('defaults a missing cached_tokens to zero', () => {
    const raw = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`;
    expect(parseSse(emptySse(), raw).chunk.usage).toEqual({
      promptTokens: 10,
      cachedTokens: 0,
      completionTokens: 2,
    });
  });

  it('ignores the opening role-only frame', () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual([]);
  });

  it('skips a malformed frame without losing the frames around it', () => {
    const raw = frame('before') + 'data: {not json\n\n' + frame('after');
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['before', 'after']);
  });

  it('tolerates CRLF line endings', () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\r\n\r\n`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['x']);
  });

  it('ignores SSE comment and event lines', () => {
    const raw = `: keep-alive\nevent: message\n${frame('x')}`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['x']);
  });
});
