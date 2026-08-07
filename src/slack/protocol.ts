// Socket Mode protocol parsing and reply matching — no React, unit-tested.

export interface MessageEvent {
  channel: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  client_msg_id?: string;
}

export type SlackIncoming =
  | { type: 'hello' }
  | { type: 'disconnect'; reason: string }
  | { type: 'events_api'; envelopeId: string; retryAttempt: number; event: MessageEvent | null };

export interface RoundMarks {
  wokeAt?: number;
  heardAt: number;
  postedAt?: number;
  replyAt?: number;
  spokeAt?: number;
}

export type AskResult =
  | { kind: 'reply'; raw: string; speakable: string; postedAt: number; replyAt: number }
  | { kind: 'timeout' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

export function parseIncoming(raw: string): SlackIncoming | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const frame = data as Record<string, unknown>;
  if (frame.type === 'hello') return { type: 'hello' };
  if (frame.type === 'disconnect') return { type: 'disconnect', reason: String(frame.reason ?? '') };
  if (frame.type === 'events_api') {
    const payload = frame.payload as { event?: Record<string, unknown> } | undefined;
    const ev = payload?.event;
    const isMessage = !!ev && ev.type === 'message' && typeof ev.channel === 'string' && typeof ev.ts === 'string';
    return {
      type: 'events_api',
      envelopeId: String(frame.envelope_id ?? ''),
      retryAttempt: Number(frame.retry_attempt ?? 0),
      event: isMessage ? (ev as unknown as MessageEvent) : null,
    };
  }
  return null;
}

export interface ReplyContext {
  channelId: string;
  evaUserId: string;
  askTs: string;
}

export function isEvaReply(ev: MessageEvent, ctx: ReplyContext): boolean {
  return (
    ev.channel === ctx.channelId &&
    ev.user === ctx.evaUserId &&
    !ev.subtype &&
    // Slack ts values must compare as numbers, not strings.
    (ev.thread_ts === ctx.askTs || parseFloat(ev.ts) > parseFloat(ctx.askTs))
  );
}

export function isSelf(ev: MessageEvent, botUserId: string): boolean {
  return ev.user === botUserId || (!ev.user && !!ev.bot_id);
}

export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}
