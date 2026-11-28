import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import { describeCut, onSpeechCut, reportCut, tailOf } from '../cuts';

describe('tailOf', () => {
  it('keeps short text whole, whitespace collapsed', () => {
    expect(tailOf('  the pie is\n ready ')).toBe('the pie is ready');
  });

  it('keeps the last words of long text, cut at a word boundary', () => {
    const t = 'I checked and the train to Boston leaves at four fifteen from the north platform';
    const tail = tailOf(t, 30);
    expect(tail.startsWith('…')).toBe(true);
    expect(t.endsWith(tail.slice(1))).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(31);
    expect(tail.slice(1, 2)).not.toBe(' ');
    expect(t).toContain(` ${tail.slice(1)}`); // started on a whole word
  });
});

describe('describeCut', () => {
  it('says how long she had been talking, why she stopped, and what she was saying', () => {
    expect(describeCut({ reason: 'playback stalled', text: 'the oven is at three fifty', playedMs: 3420 })).toBe(
      'cut after 3.4s (playback stalled) · "the oven is at three fifty"',
    );
  });

  it('leaves the time out when it is not known', () => {
    expect(describeCut({ reason: 'reply timed out', text: 'Dinner is at six.' })).toBe(
      'cut (reply timed out) · "Dinner is at six."',
    );
  });

  it('leaves the quote out when nothing was said', () => {
    expect(describeCut({ reason: 'superseded', text: '  ', playedMs: 0 })).toBe('cut after 0.0s (superseded)');
  });
});

describe('reportCut', () => {
  it('reaches the listener, and a throwing listener never escapes', () => {
    const seen: string[] = [];
    onSpeechCut((c) => seen.push(c.reason));
    reportCut({ reason: 'cancelled', text: 'x' });
    expect(seen).toEqual(['cancelled']);
    onSpeechCut(() => {
      throw new Error('boom');
    });
    expect(() => reportCut({ reason: 'cancelled', text: 'x' })).not.toThrow();
    onSpeechCut(null);
  });
});
