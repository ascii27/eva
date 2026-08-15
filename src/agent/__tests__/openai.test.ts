import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { chatStream, formatUsage, type ToolSpec } from '../openai';

describe('formatUsage', () => {
  it('reports prompt and completion tokens', () => {
    expect(formatUsage({ promptTokens: 412, cachedTokens: 0, completionTokens: 89 })).toBe('412 in · 89 out');
  });

  it('calls out the cached prefix when there was one', () => {
    expect(formatUsage({ promptTokens: 412, cachedTokens: 256, completionTokens: 89 })).toBe(
      '412 in (256 cached) · 89 out',
    );
  });

  it('omits the cached note rather than printing a zero', () => {
    expect(formatUsage({ promptTokens: 900, cachedTokens: 0, completionTokens: 12 })).not.toContain('cached');
  });
});

/**
 * Stands in for React Native's XMLHttpRequest. `responseText` accumulates
 * across deliveries, exactly as RN's incremental reader appends to it, because
 * chatStream's tail-slicing depends on that.
 */
class FakeXhr {
  static last: FakeXhr | null = null;

  status = 200;
  responseText = '';
  sentBody: Record<string, unknown> | null = null;
  /** Whether onprogress had been assigned by the time send() was called. */
  hadProgressHandlerAtSend = false;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(): void {}
  setRequestHeader(): void {}

  send(body: string): void {
    this.hadProgressHandlerAtSend = this.onprogress !== null;
    this.sentBody = JSON.parse(body);
  }

  abort(): void {
    this.onabort?.();
  }

  /** Deliver one more piece of the response body. */
  emit(text: string): void {
    this.responseText += text;
    this.onprogress?.();
  }

  finish(): void {
    this.onload?.();
  }
}

const toolFrame = (index: number, part: { id?: string; name?: string; args?: string }) => {
  const fn: Record<string, unknown> = {};
  if (part.name) fn.name = part.name;
  if (part.args !== undefined) fn.arguments = part.args;
  const call: Record<string, unknown> = { index, function: fn };
  if (part.id) {
    call.id = part.id;
    call.type = 'function';
  }
  return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] }, finish_reason: null }] })}\n\n`;
};

const contentFrame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const finishFrame = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

const CLOCK: ToolSpec = {
  name: 'clock',
  description: 'The current time and date.',
  parameters: { type: 'object', properties: {} },
};

describe('chatStream', () => {
  const original = global.XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.last = null;
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = original;
  });

  const start = (tools?: ToolSpec[]) => {
    const deltas: string[] = [];
    const promise = chatStream({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      onDelta: (d) => deltas.push(d),
    });
    const xhr = FakeXhr.last;
    if (!xhr) throw new Error('chatStream did not open a request');
    return { promise, xhr, deltas };
  };

  it('assigns onprogress before send, or RN delivers the body in one lump', () => {
    // Guards the quirk openai.ts documents: send() decides whether to stream
    // by checking whether a progress handler is already set.
    const { xhr } = start();
    expect(xhr.hadProgressHandlerAtSend).toBe(true);
  });

  it('sends tool specs wrapped as functions', () => {
    const { xhr } = start([CLOCK]);
    expect(xhr.sentBody?.tools).toEqual([{ type: 'function', function: CLOCK }]);
  });

  it('omits tools entirely when none are offered, since the API rejects an empty array', () => {
    const { xhr } = start([]);
    expect(xhr.sentBody).not.toHaveProperty('tools');
  });

  it('resolves with tool calls assembled across frames', async () => {
    const { promise, xhr } = start([CLOCK]);
    xhr.emit(toolFrame(0, { id: 'call_1', name: 'clock', args: '{"tz"' }));
    xhr.emit(toolFrame(0, { args: ':"local"}' }) + finishFrame('tool_calls'));
    xhr.emit('data: [DONE]\n\n');
    xhr.finish();
    await expect(promise).resolves.toMatchObject({
      toolCalls: [{ id: 'call_1', name: 'clock', arguments: '{"tz":"local"}' }],
    });
  });

  it('echoes an assistant message carrying the tool calls, for the next lap', async () => {
    const { promise, xhr } = start([CLOCK]);
    xhr.emit(toolFrame(0, { id: 'call_1', name: 'clock', args: '{}' }) + finishFrame('tool_calls'));
    xhr.finish();
    const res = await promise;
    expect(res.message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'clock', arguments: '{}' } }],
    });
  });

  it('streams the spoken preamble that arrives alongside a tool call', async () => {
    const { promise, xhr, deltas } = start([CLOCK]);
    xhr.emit(contentFrame('Let me check.'));
    expect(deltas).toEqual(['Let me check.']);
    xhr.emit(toolFrame(0, { id: 'call_1', name: 'clock', args: '{}' }) + finishFrame('tool_calls'));
    xhr.finish();
    const res = await promise;
    expect(res.text).toBe('Let me check.');
    expect(res.message.content).toBe('Let me check.');
  });

  it('reports no tool calls on an ordinary reply', async () => {
    const { promise, xhr } = start([CLOCK]);
    xhr.emit(contentFrame('Hello.') + finishFrame('stop'));
    xhr.finish();
    await expect(promise).resolves.toMatchObject({ text: 'Hello.', toolCalls: [] });
  });
});
