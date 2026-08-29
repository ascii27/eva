import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RealtimeSocket, type RealtimeStatus, type WebSocketLike } from '../socket';
import type { ServerEvent } from '../protocol';

class FakeWS implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  message(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** What was sent, decoded, in order. */
  events(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/** A socket wired to a fake, with the sockets and events it produced. */
function harness(opts: { staleMs?: number; connectTimeoutMs?: number } = {}) {
  const sockets: FakeWS[] = [];
  const events: ServerEvent[] = [];
  const statuses: RealtimeStatus[] = [];
  const socket = new RealtimeSocket({
    apiKey: 'sk-test',
    model: 'gpt-realtime-2.1-mini',
    onEvent: (ev) => events.push(ev),
    onStatus: (s) => statuses.push(s),
    makeWebSocket: (url, protocols) => {
      const ws = new FakeWS(url, protocols);
      sockets.push(ws);
      return ws;
    },
    ...opts,
  });
  return { socket, sockets, events, statuses, last: () => sockets[sockets.length - 1] };
}

describe('RealtimeSocket', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('dials with the model in the url and the key in a subprotocol', () => {
    const h = harness();
    h.socket.open();
    expect(h.last().url).toContain('model=gpt-realtime-2.1-mini');
    expect(h.last().protocols).toEqual(['realtime', 'openai-insecure-api-key.sk-test']);
  });

  it('buffers what is written before the socket opens, then flushes in order', () => {
    const h = harness();
    h.socket.open();
    h.socket.send({ type: 'session.update' });
    h.socket.send({ type: 'response.create' });
    expect(h.last().sent).toHaveLength(0);
    h.last().onopen?.();
    expect(h.last().events().map((e) => e.type)).toEqual(['session.update', 'response.create']);
  });

  it('does not redial a healthy socket, because wake fires more often than a conversation ends', () => {
    const h = harness();
    h.socket.open();
    h.last().onopen?.();
    h.socket.open();
    expect(h.sockets).toHaveLength(1);
  });

  it('decodes incoming frames into server events', () => {
    const h = harness();
    h.socket.open();
    h.last().onopen?.();
    h.last().message({ type: 'response.output_text.delta', delta: 'hi', response_id: 'r', item_id: 'i' });
    expect(h.events).toContainEqual({ kind: 'delta', responseId: 'r', itemId: 'i', text: 'hi' });
  });

  it('reports an unexpected close as an error, so a round in flight can fail out loud', () => {
    const h = harness();
    h.socket.open();
    h.last().onopen?.();
    h.last().onclose?.();
    expect(h.events).toContainEqual({ kind: 'error', message: 'realtime connection closed' });
    expect(h.socket.state).toBe('closed');
  });

  it('does not report a deliberate close as an error', () => {
    const h = harness();
    h.socket.open();
    h.last().onopen?.();
    h.socket.close();
    expect(h.events.filter((e) => e.kind === 'error')).toHaveLength(0);
    expect(h.socket.state).toBe('closed');
  });

  it('never reconnects on its own — the next wake dials again', () => {
    const h = harness();
    h.socket.open();
    h.last().onopen?.();
    h.last().onclose?.();
    jest.advanceTimersByTime(120_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('gives up on a dial that never opens', () => {
    const h = harness({ connectTimeoutMs: 5_000 });
    h.socket.open();
    jest.advanceTimersByTime(5_001);
    expect(h.socket.state).toBe('closed');
    expect(h.events).toContainEqual({ kind: 'error', message: 'realtime connection closed' });
  });

  it('drops a socket that has gone silent', () => {
    const h = harness({ staleMs: 30_000 });
    h.socket.open();
    h.last().onopen?.();
    jest.advanceTimersByTime(29_000);
    expect(h.socket.state).toBe('open');
    jest.advanceTimersByTime(2_000);
    expect(h.socket.state).toBe('closed');
  });

  it('re-arms the watchdog on every frame', () => {
    const h = harness({ staleMs: 30_000 });
    h.socket.open();
    h.last().onopen?.();
    jest.advanceTimersByTime(25_000);
    h.last().message({ type: 'rate_limits.updated' });
    jest.advanceTimersByTime(25_000);
    expect(h.socket.state).toBe('open');
  });

  it('survives a silence it was told to expect — a consent gate is not a dead link', () => {
    const h = harness({ staleMs: 30_000 });
    h.socket.open();
    h.last().onopen?.();
    h.socket.hold(true);
    jest.advanceTimersByTime(120_000);
    expect(h.socket.state).toBe('open');
    h.socket.hold(false);
    jest.advanceTimersByTime(31_000);
    expect(h.socket.state).toBe('closed');
  });

  it('resolves whenReady once open, and false when the dial fails', async () => {
    const h = harness({ connectTimeoutMs: 5_000 });
    h.socket.open();
    const ready = h.socket.whenReady(10_000);
    h.last().onopen?.();
    await expect(ready).resolves.toBe(true);

    const h2 = harness({ connectTimeoutMs: 5_000 });
    h2.socket.open();
    const never = h2.socket.whenReady(10_000);
    jest.advanceTimersByTime(5_001);
    await expect(never).resolves.toBe(false);
  });

  it('answers whenReady immediately when there is no socket at all', async () => {
    const h = harness();
    await expect(h.socket.whenReady(10_000)).resolves.toBe(false);
  });
});
