import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { MessageEvent } from '../protocol';
import { SlackSocket, type SocketStatus, type WebSocketLike } from '../socket';

class FakeWS implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {}

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
}

const HELLO = { type: 'hello' };

function envelope(id: string, retry = 0, text = 'hi') {
  return {
    type: 'events_api',
    envelope_id: id,
    retry_attempt: retry,
    payload: { event: { type: 'message', channel: 'C1', user: 'U1', text, ts: '2.0' } },
  };
}

describe('SlackSocket', () => {
  let sockets: FakeWS[];
  let urls: number;
  let events: MessageEvent[];
  let statuses: SocketStatus[];
  let socket: SlackSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    urls = 0;
    events = [];
    statuses = [];
    socket = new SlackSocket({
      getUrl: async () => `wss://slack.test/${++urls}`,
      onEvent: (ev) => events.push(ev),
      onStatus: (s) => statuses.push(s),
      makeWebSocket: (url) => {
        const ws = new FakeWS(url);
        sockets.push(ws);
        return ws;
      },
      staleMs: 5000,
    });
  });

  afterEach(() => {
    socket.stop();
    jest.useRealTimers();
  });

  it('fetches a url, connects, and reports connected on hello', async () => {
    await socket.start();
    expect(sockets).toHaveLength(1);
    sockets[0].message(HELLO);
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('acks every events_api envelope immediately', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    sockets[0].message(envelope('env-1'));
    expect(sockets[0].sent).toContainEqual(JSON.stringify({ envelope_id: 'env-1' }));
  });

  it('forwards message events to onEvent', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    sockets[0].message(envelope('env-1', 0, 'hello there'));
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello there');
  });

  it('acks but does not re-forward redelivered envelopes', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    sockets[0].message(envelope('env-1'));
    sockets[0].message(envelope('env-1', 1));
    expect(events).toHaveLength(1);
    expect(sockets[0].sent.filter((s) => s.includes('env-1'))).toHaveLength(2);
  });

  it('reconnects with a freshly fetched url on a disconnect frame', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    sockets[0].message({ type: 'disconnect', reason: 'refresh_requested' });
    await jest.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].url).not.toBe(sockets[0].url);
  });

  it('reconnects with backoff after an unexpected close', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    sockets[0].onclose?.(); // dropped by the network, not by us
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    await jest.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
  });

  it('reconnects when no traffic arrives within the stale window', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    await jest.advanceTimersByTimeAsync(5000);
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
  });

  it('does not reconnect after stop', async () => {
    await socket.start();
    sockets[0].message(HELLO);
    socket.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe('disconnected');
  });

  it('retries when fetching the url itself fails', async () => {
    let calls = 0;
    const failing = new SlackSocket({
      getUrl: async () => {
        calls++;
        if (calls === 1) throw new Error('network down');
        return 'wss://slack.test/ok';
      },
      onEvent: () => {},
      makeWebSocket: (url) => {
        const ws = new FakeWS(url);
        sockets.push(ws);
        return ws;
      },
    });
    await failing.start();
    expect(sockets).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);
    failing.stop();
  });
});
