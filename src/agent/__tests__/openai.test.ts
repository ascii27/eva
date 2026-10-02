import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { chatStream, formatUsage, OPENAI_BASE, type ToolSpec } from '../openai';

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
  url: string | null = null;
  /** Every setRequestHeader call, in order — repeats included, since XHR appends. */
  headers: [string, string][] = [];
  /** Whether onprogress had been assigned by the time send() was called. */
  hadProgressHandlerAtSend = false;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }

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

  // The bridge to hermes-agent is nothing but these two options, so they are
  // worth pinning: hermes' API server is OpenAI-compatible, and src/hermes/
  // reaches it by pointing this same client somewhere else.
  describe('endpoint options', () => {
    it('defaults to OpenAI', () => {
      const { xhr } = start();
      expect(xhr.url).toBe(`${OPENAI_BASE}/chat/completions`);
    });

    it('posts to a supplied baseUrl instead', () => {
      void chatStream({
        apiKey: 'sk-test',
        model: 'hermes',
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: 'https://hermes.example/v1',
        onDelta: () => {},
      });
      expect(FakeXhr.last?.url).toBe('https://hermes.example/v1/chat/completions');
    });

    it('sends caller headers alongside the managed ones', () => {
      void chatStream({
        apiKey: 'sk-test',
        model: 'hermes',
        messages: [{ role: 'user', content: 'hi' }],
        headers: { 'X-Hermes-Session-Key': 'eva-device' },
        onDelta: () => {},
      });
      expect(FakeXhr.last?.headers).toContainEqual(['X-Hermes-Session-Key', 'eva-device']);
      expect(FakeXhr.last?.headers).toContainEqual(['Authorization', 'Bearer sk-test']);
    });

    it('drops a caller header that would collide, rather than appending to it', () => {
      // XHR concatenates repeats into `Bearer theirs, Bearer sk-test`, which is
      // not a credential anyone accepts — so the managed three are filtered out
      // of the caller's map instead of being overwritten.
      void chatStream({
        apiKey: 'sk-test',
        model: 'hermes',
        messages: [{ role: 'user', content: 'hi' }],
        headers: { authorization: 'Bearer theirs' },
        onDelta: () => {},
      });
      const auth = FakeXhr.last?.headers.filter(([name]) => name.toLowerCase() === 'authorization');
      expect(auth).toEqual([['Authorization', 'Bearer sk-test']]);
    });
  });
});

/**
 * Named events on the stream. OpenAI never sends them; hermes-agent's API
 * server narrates its server-side tool runs with `hermes.tool.progress`, and on
 * that brain the model streams no preamble before a tool — so this callback is
 * the only warning a round gets before 8-16s of silence.
 */
describe('chatStream, named events', () => {
  const original = global.XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.last = null;
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = original;
  });

  const progressFrame = (body: Record<string, unknown>) =>
    `event: hermes.tool.progress\ndata: ${JSON.stringify(body)}\n\n`;

  const startWithEvents = (onEvent?: (events: { name: string; data: string }[]) => void) => {
    const deltas: string[] = [];
    const promise = chatStream({
      apiKey: 'sk-test',
      model: 'hermes-agent',
      messages: [{ role: 'user', content: 'what time is it' }],
      onDelta: (d) => deltas.push(d),
      onEvent,
    });
    const xhr = FakeXhr.last;
    if (!xhr) throw new Error('chatStream did not open a request');
    return { promise, xhr, deltas };
  };

  it('hands a named event to onEvent as it arrives', async () => {
    const seen: { name: string; data: string }[][] = [];
    const { promise, xhr, deltas } = startWithEvents((e) => seen.push(e));

    xhr.emit(progressFrame({ tool: 'terminal', status: 'running' }));
    expect(seen).toEqual([[{ name: 'hermes.tool.progress', data: '{"tool":"terminal","status":"running"}' }]]);
    // The point of arriving early: nothing has been spoken yet.
    expect(deltas).toEqual([]);

    xhr.emit(contentFrame('Half past two.') + finishFrame('stop'));
    xhr.finish();
    await expect(promise).resolves.toMatchObject({ text: 'Half past two.' });
  });

  it('is not called at all on an ordinary OpenAI stream', async () => {
    let calls = 0;
    const { promise, xhr } = startWithEvents(() => {
      calls += 1;
    });
    xhr.emit(contentFrame('Hi') + finishFrame('stop'));
    xhr.finish();
    await promise;
    expect(calls).toBe(0);
  });

  it('settles the reply even when onEvent throws', async () => {
    // Same guard onDelta already has: a bad consumer must not be able to leave
    // the promise pending forever, which would wedge the face in `thinking`
    // and leave the wake watcher suspended.
    const { promise, xhr } = startWithEvents(() => {
      throw new Error('consumer blew up');
    });
    xhr.emit(progressFrame({ tool: 'terminal', status: 'running' }));
    xhr.emit(contentFrame('ok') + finishFrame('stop'));
    xhr.finish();
    await expect(promise).resolves.toMatchObject({ text: 'ok' });
  });

  it('streams fine with no onEvent supplied', async () => {
    const { promise, xhr } = startWithEvents(undefined);
    xhr.emit(progressFrame({ tool: 'terminal', status: 'running' }));
    xhr.emit(contentFrame('ok') + finishFrame('stop'));
    xhr.finish();
    await expect(promise).resolves.toMatchObject({ text: 'ok' });
  });
});
