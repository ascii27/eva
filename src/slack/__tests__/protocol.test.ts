import { describe, expect, it } from '@jest/globals';
import { backoffDelay, isEvaReply, isSelf, parseIncoming, type MessageEvent } from '../protocol';

const EVA = 'U0B7PD9CWSX';
const CHANNEL = 'C0B7ZEBTVK6';
const BOT = 'U0BOTBOTBOT';

const ctx = { channelId: CHANNEL, evaUserId: EVA, askTs: '1754500000.000100' };

function evaMsg(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return { channel: CHANNEL, user: EVA, text: 'hi', ts: '1754500010.000200', ...overrides };
}

describe('parseIncoming', () => {
  it('parses hello frames', () => {
    expect(parseIncoming(JSON.stringify({ type: 'hello', num_connections: 1 }))).toEqual({ type: 'hello' });
  });

  it('parses disconnect frames with their reason', () => {
    expect(parseIncoming(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested' }))).toEqual({
      type: 'disconnect',
      reason: 'refresh_requested',
    });
  });

  it('parses events_api envelopes carrying a message event', () => {
    const frame = {
      type: 'events_api',
      envelope_id: 'env-1',
      retry_attempt: 0,
      payload: { event: { type: 'message', channel: CHANNEL, user: EVA, text: 'hi', ts: '1.2' } },
    };
    expect(parseIncoming(JSON.stringify(frame))).toEqual({
      type: 'events_api',
      envelopeId: 'env-1',
      retryAttempt: 0,
      event: { type: 'message', channel: CHANNEL, user: EVA, text: 'hi', ts: '1.2' },
    });
  });

  it('yields a null event for events_api envelopes that are not messages', () => {
    const frame = {
      type: 'events_api',
      envelope_id: 'env-2',
      retry_attempt: 1,
      payload: { event: { type: 'reaction_added', item: {} } },
    };
    expect(parseIncoming(JSON.stringify(frame))).toEqual({
      type: 'events_api',
      envelopeId: 'env-2',
      retryAttempt: 1,
      event: null,
    });
  });

  it('returns null for garbage and non-object frames', () => {
    expect(parseIncoming('not json')).toBeNull();
    expect(parseIncoming('"just a string"')).toBeNull();
    expect(parseIncoming(JSON.stringify({ type: 'unknown_frame' }))).toBeNull();
  });
});

describe('isEvaReply', () => {
  it('accepts an Eva channel message after the ask', () => {
    expect(isEvaReply(evaMsg(), ctx)).toBe(true);
  });

  it('accepts an Eva thread reply on the ask message', () => {
    expect(isEvaReply(evaMsg({ thread_ts: ctx.askTs }), ctx)).toBe(true);
  });

  it('rejects messages in other channels', () => {
    expect(isEvaReply(evaMsg({ channel: 'C0OTHER' }), ctx)).toBe(false);
  });

  it('rejects messages from other users', () => {
    expect(isEvaReply(evaMsg({ user: 'U0SOMEONE' }), ctx)).toBe(false);
  });

  it('rejects subtyped events like edits and joins', () => {
    expect(isEvaReply(evaMsg({ subtype: 'message_changed' }), ctx)).toBe(false);
    expect(isEvaReply(evaMsg({ subtype: 'channel_join' }), ctx)).toBe(false);
  });

  it('rejects messages from before the ask', () => {
    expect(isEvaReply(evaMsg({ ts: '1754499999.000100' }), ctx)).toBe(false);
  });

  it('compares timestamps numerically, not lexically', () => {
    // Lexically '1754500000.000099' > '1754500000.0001' is false only under
    // numeric comparison of the fractional part as a whole float.
    expect(isEvaReply(evaMsg({ ts: '1754500000.20' }), { ...ctx, askTs: '1754500000.000100' })).toBe(true);
  });
});

describe('isSelf', () => {
  it('flags our own bot user posts echoed back', () => {
    expect(isSelf(evaMsg({ user: BOT }), BOT)).toBe(true);
  });

  it('flags bot-integration posts with no user', () => {
    expect(isSelf(evaMsg({ user: undefined, bot_id: 'B0ABCDEF' }), BOT)).toBe(true);
  });

  it('passes ordinary user messages', () => {
    expect(isSelf(evaMsg(), BOT)).toBe(false);
  });
});

describe('backoffDelay', () => {
  it('doubles from one second and caps at thirty', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(3)).toBe(8000);
    expect(backoffDelay(10)).toBe(30_000);
  });
});
