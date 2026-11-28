import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import { describeCut, onSpeechEvent, readReply, readUtterance, reportCut, tailOf, type UtteranceTrace } from '../cuts';

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
    onSpeechEvent((e) => {
      if (e.kind === 'cut') seen.push(e.cut.reason);
    });
    reportCut({ reason: 'cancelled', text: 'x' });
    expect(seen).toEqual(['cancelled']);
    onSpeechEvent(() => {
      throw new Error('boom');
    });
    expect(() => reportCut({ reason: 'cancelled', text: 'x' })).not.toThrow();
    onSpeechEvent(null);
  });
});

describe('readUtterance', () => {
  const text = 'x'.repeat(300); // ≈ 20s of speech at 15 chars a second
  const base: UtteranceTrace = {
    text,
    end: 'drained',
    stats: { how: 'drained', synthesizedS: 19, playedS: 19, chunks: 12, underruns: 0 },
    micOpen: false,
    appState: 'active',
  };

  it('a reply that played in full is not a suspect', () => {
    const r = readUtterance(base);
    expect(r.suspect).toBeNull();
    expect(r.line).toContain('300 chars · 19.0s synthesized / 19.0s played (text ≈ 20.0s)');
  });

  it('far too little audio for the text is the synthesizer dropping text', () => {
    const r = readUtterance({ ...base, stats: { ...base.stats, synthesizedS: 8, playedS: 8 } });
    expect(r.suspect).toBe('too little audio for its text');
  });

  it('audio synthesized but never played is the player losing it', () => {
    const r = readUtterance({ ...base, stats: { ...base.stats, playedS: 15 } });
    expect(r.suspect).toBe('audio synthesized but not played');
  });

  it('any end but a drain is a suspect, and so are an open mic and a backgrounded app', () => {
    const r = readUtterance({ ...base, end: 'playback stalled', micOpen: true, appState: 'background' });
    expect(r.suspect).toBe('ended playback stalled, mic was open, app background');
  });

  it('a short line is not judged by its rate', () => {
    expect(readUtterance({ ...base, text: 'Sure.', stats: { ...base.stats, synthesizedS: 0.2, playedS: 0.2 } }).suspect).toBeNull();
  });
});

describe('readReply', () => {
  it('a reply whose last words reached the speaker is fine, whatever the flattening', () => {
    const r = readReply({
      kind: 'reply',
      received: 'Dinner is at six. **Did Cedric** RSVP?',
      pushed: 'Dinner is at six. Did Cedric RSVP?',
    });
    expect(r.suspect).toBeNull();
  });

  it('a lost final sentence is caught — the Nov 28 report', () => {
    const r = readReply({
      kind: 'reply',
      received: 'Dinner is at six and the pie is cooling. Do you want me to check whether Cedric is coming?',
      pushed: 'Dinner is at six and the pie is cooling.',
    });
    expect(r.suspect).toBe('its last words never reached the speaker');
  });

  it('a preamble cleared at a tool boundary does not count against it', () => {
    const r = readReply({ kind: 'reply', received: 'It is 4pm in Boston.', pushed: 'It is 4pm in Boston.' });
    expect(r.suspect).toBeNull();
  });

  it('a failed round says so', () => {
    expect(readReply({ kind: 'timeout', received: '', pushed: 'Dinner is at' }).suspect).toBe('timeout');
  });
});
