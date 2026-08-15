import { describe, expect, it } from '@jest/globals';
import { formatLatency } from '../ask';

describe('formatLatency', () => {
  it('reports post, eva, and wake-to-audio total for a full round', () => {
    expect(
      formatLatency({ wokeAt: 0, heardAt: 1000, postedAt: 1400, replyAt: 4400, spokeAt: 5100 }),
    ).toBe('latency · post 0.4s · eva 3.0s · total 5.1s');
  });

  it('measures total from heardAt when there was no wake (dev ask)', () => {
    expect(formatLatency({ heardAt: 1000, postedAt: 1400, replyAt: 4400, spokeAt: 5100 })).toBe(
      'latency · post 0.4s · eva 3.0s · total 4.1s',
    );
  });

  it('reports a timed-out round as no reply', () => {
    expect(formatLatency({ heardAt: 1000, postedAt: 1400 })).toBe('latency · post 0.4s · no reply');
  });
});
