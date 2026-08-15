import { describe, expect, it } from '@jest/globals';
import { emptySse, parseSse } from '../sse';

/** One OpenAI content frame. */
const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/**
 * One tool-call frame. The API sends `id`/`name` on the first frame for an
 * index and appends `arguments` fragments on the rest, so both are optional.
 */
const toolFrame = (index: number, part: { id?: string; name?: string; args?: string }) => {
  const call: Record<string, unknown> = { index };
  if (part.id) call.id = part.id;
  if (part.id) call.type = 'function';
  const fn: Record<string, unknown> = {};
  if (part.name) fn.name = part.name;
  if (part.args !== undefined) fn.arguments = part.args;
  call.function = fn;
  return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] }, finish_reason: null }] })}\n\n`;
};

/** The frame that closes a choice, carrying the reason it stopped. */
const finishFrame = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

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

  it('skips a frame whose payload is valid JSON but not an object', () => {
    // JSON.parse succeeds on all three, so the try/catch does not catch them.
    for (const payload of ['null', '42', '"just a string"', 'true']) {
      expect(() => parseSse(emptySse(), `data: ${payload}\n\n`)).not.toThrow();
      expect(parseSse(emptySse(), `data: ${payload}\n\n`).chunk.deltas).toEqual([]);
    }
  });

  it('keeps parsing after a non-object payload', () => {
    const raw = 'data: null\n\n' + `data: ${JSON.stringify({ choices: [{ delta: { content: 'after' } }] })}\n\n`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['after']);
  });

  it('carries a frame split exactly at the data: prefix boundary', () => {
    // The brief names this split point explicitly; nothing covered it.
    const first = parseSse(emptySse(), 'data:');
    expect(first.chunk.deltas).toEqual([]);
    const second = parseSse(first.state, ` ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`);
    expect(second.chunk.deltas).toEqual(['x']);
  });

  it('reports no tool calls on an ordinary content turn', () => {
    const { chunk } = parseSse(emptySse(), frame('Hello') + finishFrame('stop'));
    expect(chunk.toolCalls).toEqual([]);
  });
});

describe('parseSse tool calls', () => {
  it('assembles a tool call fragmented across frames', () => {
    const raw =
      toolFrame(0, { id: 'call_1', name: 'web_search', args: '' }) +
      toolFrame(0, { args: '{"query":' }) +
      toolFrame(0, { args: '"eva"}' }) +
      finishFrame('tool_calls');
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([{ id: 'call_1', name: 'web_search', arguments: '{"query":"eva"}' }]);
  });

  it('assembles arguments split mid-JSON-token across chunk boundaries', () => {
    // The split lands inside the string literal "san francisco", which is
    // exactly where a naive per-frame JSON.parse would fall over.
    const whole =
      toolFrame(0, { id: 'call_1', name: 'web_search', args: '' }) +
      toolFrame(0, { args: '{"query":"san fran' }) +
      toolFrame(0, { args: 'cisco weather"}' }) +
      finishFrame('tool_calls');
    const cut = Math.floor(whole.length / 2);
    const first = parseSse(emptySse(), whole.slice(0, cut));
    expect(first.chunk.toolCalls).toEqual([]);
    const second = parseSse(first.state, whole.slice(cut));
    expect(second.chunk.toolCalls).toEqual([
      { id: 'call_1', name: 'web_search', arguments: '{"query":"san francisco weather"}' },
    ]);
  });

  it('holds a tool call back until the stream reports it is finished', () => {
    // Emitting early would hand the dispatcher half a JSON object.
    const raw = toolFrame(0, { id: 'call_1', name: 'clock', args: '{' }) + toolFrame(0, { args: '}' });
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([]);
  });

  it('assembles two parallel tool calls in index order', () => {
    const raw =
      toolFrame(1, { id: 'call_b', name: 'clock', args: '{}' }) +
      toolFrame(0, { id: 'call_a', name: 'memory_search', args: '{"q":"x"}' }) +
      finishFrame('tool_calls');
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([
      { id: 'call_a', name: 'memory_search', arguments: '{"q":"x"}' },
      { id: 'call_b', name: 'clock', arguments: '{}' },
    ]);
  });

  it('emits tool calls on [DONE] when the finish frame never arrived', () => {
    const raw = toolFrame(0, { id: 'call_1', name: 'clock', args: '{}' }) + 'data: [DONE]\n\n';
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([{ id: 'call_1', name: 'clock', arguments: '{}' }]);
  });

  it('does not re-emit tool calls after the finish frame flushed them', () => {
    // finish_reason and [DONE] both flush; without a reset the round would
    // dispatch the same tool twice.
    const first = parseSse(
      emptySse(),
      toolFrame(0, { id: 'call_1', name: 'clock', args: '{}' }) + finishFrame('tool_calls'),
    );
    expect(first.chunk.toolCalls).toHaveLength(1);
    const second = parseSse(first.state, 'data: [DONE]\n\n');
    expect(second.chunk.toolCalls).toEqual([]);
  });

  it('reads content deltas interleaved with tool-call frames', () => {
    // The preamble Eva speaks aloud arrives on the same response as the call.
    const raw =
      frame('Let me look that up.') +
      toolFrame(0, { id: 'call_1', name: 'web_search', args: '{"query":"x"}' }) +
      finishFrame('tool_calls');
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.deltas).toEqual(['Let me look that up.']);
    expect(chunk.toolCalls).toHaveLength(1);
  });

  it('keeps accumulating after a malformed tool-call frame', () => {
    const raw =
      toolFrame(0, { id: 'call_1', name: 'clock', args: '{"a"' }) +
      'data: {not json\n\n' +
      toolFrame(0, { args: ':1}' }) +
      finishFrame('tool_calls');
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([{ id: 'call_1', name: 'clock', arguments: '{"a":1}' }]);
  });

  it('emits a truncated call rather than dropping it, so dispatch can report the error', () => {
    // finish_reason 'length' means max_tokens cut the arguments off mid-JSON.
    const raw = toolFrame(0, { id: 'call_1', name: 'web_search', args: '{"query":"unfin' }) + finishFrame('length');
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.toolCalls).toEqual([{ id: 'call_1', name: 'web_search', arguments: '{"query":"unfin' }]);
  });

  it('ignores a tool-call frame with no index', () => {
    const raw = `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ function: { arguments: '{}' } }] }, finish_reason: null }] })}\n\n`;
    expect(() => parseSse(emptySse(), raw)).not.toThrow();
    expect(parseSse(emptySse(), raw + finishFrame('tool_calls')).chunk.toolCalls).toEqual([]);
  });
});
