// The realtime connection lifecycle — non-React, unit-tested via an injected
// WebSocket factory, in the shape src/slack/socket.ts established.
//
// Two deliberate differences from SlackSocket, both load-bearing:
//
// 1. It does not reconnect on its own. Slack's socket is Eva's ear on the
//    world and must always be up; this one exists only for the length of a
//    conversation, and a drop mid-round is answered by failing the round out
//    loud rather than redialling underneath it. Silent recovery here would
//    also be a lie: the server-side conversation is gone, so a reconnected
//    socket is not the one the round was speaking to. The next wake dials
//    again, which is the only recovery that is actually honest.
//
// 2. Its watchdog can be held. Slack has no legitimate long silence, so its
//    watchdog is unconditional. Here a spoken consent gate leaves the socket
//    quiet for ten seconds or more while a human decides — plus an iOS
//    permission dialog on first use — which is indistinguishable from a dead
//    link and would otherwise tear down the round that is waiting on it. This
//    is the same suspension `speech.hold` performs on audioOut's stall
//    watchdog, for the same reason.
//
// Auth rides in a subprotocol rather than a header. React Native does support
// a headers option, but the subprotocol form is what probe:realtime measured
// working, it is identical in node and on the device, and it avoids depending
// on an RN extension that this repo has never exercised. The key is already
// in the bundle and in AsyncStorage in plain text (see config.ts) — this adds
// no exposure that was not already accepted.

import { decode, type ClientEvent, type ServerEvent } from './protocol';

export type RealtimeStatus = 'closed' | 'connecting' | 'open';

export const REALTIME_BASE = 'wss://api.openai.com/v1/realtime';

/** A socket silent for this long is treated as dead. Suspended while held. */
export const STALE_MS = 90_000;
/** A dial that has not opened by now is black-holed. */
export const CONNECT_TIMEOUT_MS = 15_000;

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: (() => void) | null;
}

export interface RealtimeSocketOptions {
  apiKey: string;
  model: string;
  onEvent: (ev: ServerEvent) => void;
  onStatus?: (s: RealtimeStatus) => void;
  makeWebSocket?: (url: string, protocols: string[]) => WebSocketLike;
  staleMs?: number;
  connectTimeoutMs?: number;
}

export class RealtimeSocket {
  private ws: WebSocketLike | null = null;
  private gen = 0;
  private status: RealtimeStatus = 'closed';
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private holding = false;
  /** Events written before the socket opened, flushed in order on open. */
  private pending: string[] = [];
  private readyWaiters: ((ok: boolean) => void)[] = [];

  constructor(private readonly opts: RealtimeSocketOptions) {}

  get state(): RealtimeStatus {
    return this.status;
  }

  /**
   * Dial, superseding any live socket. Safe to call when already open — the
   * wake word fires more often than a conversation ends, and re-dialling a
   * healthy socket would throw away the context it is holding.
   */
  open(): void {
    if (this.status !== 'closed') return;
    const dial = ++this.gen;
    this.setStatus('connecting');
    const url = `${REALTIME_BASE}?model=${encodeURIComponent(this.opts.model)}`;
    const protocols = ['realtime', `openai-insecure-api-key.${this.opts.apiKey}`];
    const make =
      this.opts.makeWebSocket ??
      ((u: string, p: string[]) => new WebSocket(u, p) as unknown as WebSocketLike);

    let ws: WebSocketLike;
    try {
      ws = make(url, protocols);
    } catch {
      this.setStatus('closed');
      this.settleWaiters(false);
      return;
    }
    this.ws = ws;
    this.arm(this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws || dial !== this.gen) return;
      this.setStatus('open');
      this.rearm();
      const queued = this.pending;
      this.pending = [];
      for (const raw of queued) ws.send(raw);
      this.settleWaiters(true);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.rearm();
      const decoded = decode(String(ev.data));
      if (decoded) this.opts.onEvent(decoded);
    };
    ws.onerror = () => {
      // The close path owns recovery, exactly as in slack/socket.ts.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded
      this.drop();
    };
  }

  /** Close deliberately. Nothing is reported as an error: this is the plan. */
  close(): void {
    this.gen++;
    this.teardown();
    this.pending = [];
    this.setStatus('closed');
    this.settleWaiters(false);
  }

  send(event: ClientEvent): void {
    const raw = JSON.stringify(event);
    if (this.status === 'open' && this.ws) {
      this.ws.send(raw);
      return;
    }
    // Buffering rather than exposing readyState keeps the test fake trivial,
    // and lets a round be composed the instant a wake dials the socket.
    if (this.status === 'connecting') this.pending.push(raw);
  }

  /**
   * Suspend the liveness watchdog across a silence we asked for — a spoken
   * consent gate, or a tool the human is being consulted about.
   */
  hold(on: boolean): void {
    this.holding = on;
    if (on) this.clear();
    else this.rearm();
  }

  /**
   * Resolve once the socket is usable, or false if it will not be within
   * `ms`. A round dialled at wake is normally open long before anyone stops
   * talking; this exists so a slow dial degrades to a spoken failure instead
   * of an unhandled rejection.
   */
  whenReady(ms: number): Promise<boolean> {
    if (this.status === 'open') return Promise.resolve(true);
    if (this.status === 'closed') return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.readyWaiters.indexOf(waiter);
        if (i >= 0) this.readyWaiters.splice(i, 1);
        resolve(false);
      }, ms);
      const waiter = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      this.readyWaiters.push(waiter);
    });
  }

  private settleWaiters(ok: boolean): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w(ok);
  }

  /** An unexpected close: report it so the round in flight can fail honestly. */
  private drop(): void {
    this.teardown();
    this.pending = [];
    this.setStatus('closed');
    this.settleWaiters(false);
    this.opts.onEvent({ kind: 'error', message: 'realtime connection closed' });
  }

  private setStatus(s: RealtimeStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private clear(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private arm(ms: number): void {
    this.clear();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.drop();
    }, ms);
  }

  private rearm(): void {
    if (this.holding || this.status !== 'open') return;
    this.arm(this.opts.staleMs ?? STALE_MS);
  }

  private teardown(): void {
    this.clear();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      // already dead
    }
  }
}
