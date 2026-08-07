// Socket Mode connection lifecycle — non-React, unit-tested via an injected
// WebSocket factory.
//
// Slack's contract: every connect fetches a fresh single-use wss URL
// (apps.connections.open), the server greets with `hello`, warns with a
// `disconnect` frame before refreshing a link, and redelivers any events_api
// envelope that isn't acked within ~3s. RN's WebSocket exposes no ping/pong
// to JS, so traffic watchdogs stand in for liveness: a short one on the dial
// (no first frame) and a long one on an established link. A generation
// counter serializes connects — at most one socket is ever live, and every
// path that starts a new dial supersedes timers and the previous socket
// first, so a reconnect timer and a watchdog can never both dial.

import { backoffDelay, parseIncoming, type MessageEvent } from './protocol';

export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

/** Slack pings roughly every 30s; several missed intervals means a dead link. */
export const STALE_MS = 150_000;
/** A dial that hasn't produced hello (or any frame) by now is black-holed. */
export const CONNECT_TIMEOUT_MS = 20_000;
const DEDUPE_MAX = 50;

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: (() => void) | null;
}

export interface SlackSocketOptions {
  getUrl: () => Promise<string>;
  onEvent: (ev: MessageEvent) => void;
  onStatus?: (s: SocketStatus) => void;
  makeWebSocket?: (url: string) => WebSocketLike;
  staleMs?: number;
  connectTimeoutMs?: number;
}

export class SlackSocket {
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private gen = 0;
  private seenEnvelopes: string[] = [];
  private status: SocketStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: SlackSocketOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.attempt = 0;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    this.clearTimers();
    this.teardown();
    this.setStatus('disconnected');
  }

  /** Immediate reconnect nudge (AppState active, dev Reconnect button). */
  async reconnectNow(): Promise<void> {
    if (this.stopped) return;
    this.attempt = 0;
    await this.connect();
  }

  private setStatus(s: SocketStatus) {
    if (s === this.status) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.reconnectTimer = null;
    this.watchdogTimer = null;
  }

  /** Close the current socket without treating it as an unexpected drop. */
  private teardown() {
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

  /** Begin a new dial, superseding any pending timer, dial, or live socket. */
  private async connect(): Promise<void> {
    if (this.stopped) return;
    const dial = ++this.gen;
    this.clearTimers();
    this.teardown();
    this.setStatus('connecting');
    let url: string;
    try {
      url = await this.opts.getUrl(); // single-use URL — fresh every attempt
    } catch {
      if (dial === this.gen) this.scheduleReconnect();
      return;
    }
    if (this.stopped || dial !== this.gen) return; // a newer dial took over
    if (__DEV__) url += `${url.includes('?') ? '&' : '?'}debug_reconnects=true`;
    const make = this.opts.makeWebSocket ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    const ws = make(url);
    this.ws = ws;
    this.armWatchdog(this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.handleMessage(String(ev.data));
    };
    ws.onerror = () => {
      // RN follows onerror with onclose; the close path owns recovery.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded socket
      this.ws = null;
      this.clearTimers();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.setStatus('disconnected');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, backoffDelay(this.attempt++));
  }

  /** No traffic within ms → the link (or dial) is dead; dial fresh. */
  private armWatchdog(ms: number) {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      void this.connect();
    }, ms);
  }

  private handleMessage(raw: string) {
    this.armWatchdog(this.opts.staleMs ?? STALE_MS);
    const frame = parseIncoming(raw);
    if (!frame) return;
    if (frame.type === 'hello') {
      this.attempt = 0;
      this.setStatus('connected');
      return;
    }
    if (frame.type === 'disconnect') {
      // Graceful refresh: swap to a fresh link before the old one dies.
      void this.connect();
      return;
    }
    // Ack before processing — Slack redelivers (and eventually drops the
    // connection) when acks arrive late.
    this.ws?.send(JSON.stringify({ envelope_id: frame.envelopeId }));
    if (this.seenEnvelopes.includes(frame.envelopeId)) return;
    this.seenEnvelopes.push(frame.envelopeId);
    if (this.seenEnvelopes.length > DEDUPE_MAX) this.seenEnvelopes.shift();
    if (frame.event) this.opts.onEvent(frame.event);
  }
}
