import { describe, expect, it } from '@jest/globals';
import { emptyCues, flushCues, hasCues, pauseMs, PAUSE_DEFAULT_MS, PAUSE_MAX_MS, pushCues, type CueItem } from '../cues';
import { speakableFromMrkdwn } from '../speakable';

/** Feed a reply in the given chunks and collect every item, as the player would. */
function stream(chunks: string[]): CueItem[] {
  let state = emptyCues();
  const items: CueItem[] = [];
  for (const c of chunks) {
    const r = pushCues(state, c);
    state = r.state;
    items.push(...r.items);
  }
  items.push(...flushCues(state));
  return items;
}

/** Items with adjacent text merged, for readable expectations. */
function shape(items: CueItem[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    const s = i.kind === 'text' ? i.text : i.kind === 'face' ? `<face ${i.token.name}>` : `<pause ${i.ms}>`;
    if (i.kind === 'text' && out.length && !out[out.length - 1].startsWith('<')) out[out.length - 1] += s;
    else out.push(s);
  }
  return out;
}

describe('pauseMs', () => {
  it.each([
    ['', PAUSE_DEFAULT_MS],
    ['1s', 1000],
    ['1.5 seconds', 1500],
    ['2', PAUSE_MAX_MS],
    ['0.5', 500],
    ['800', 800],
    ['800ms', 800],
    ['250 milliseconds', 250],
    ['a moment', PAUSE_DEFAULT_MS],
    ['30s', PAUSE_MAX_MS],
    ['9000', PAUSE_MAX_MS],
  ])('"%s" is %d ms', (arg, ms) => {
    expect(pauseMs(arg)).toBe(ms);
  });
});

describe('cutting cues out of a stream', () => {
  it('orders text, faces and pauses as written', () => {
    const items = stream(['[[face happy]] Hi! [[pause 1s]] [[face concerned]] Bad news though.']);
    expect(shape(items)).toEqual(['<face happy>', ' Hi! ', '<pause 1000>', ' ', '<face concerned>', ' Bad news though.']);
  });

  it('holds a token split across deltas until it closes', () => {
    const items = stream(['Okay ', '[', '[fa', 'ce sur', 'prised]', '] wow', ' [[pause', ']] done']);
    expect(shape(items)).toEqual(['Okay ', '<face surprised>', ' wow ', `<pause ${PAUSE_DEFAULT_MS}>`, ' done']);
  });

  it('never releases a half token as text', () => {
    const r = pushCues(emptyCues(), 'Hello [[fa');
    expect(r.items).toEqual([{ kind: 'text', text: 'Hello ' }]);
    expect(r.state.held).toBe('[[fa');
  });

  it('gives up holding something that was never a token', () => {
    const long = `[[${'x'.repeat(60)}`;
    expect(pushCues(emptyCues(), long).items).toEqual([{ kind: 'text', text: long }]);
  });

  it('leaves other desk tokens in the text, for the speaker to strip', () => {
    expect(shape(stream(['Goodnight. [[sleep]]']))).toEqual(['Goodnight. [[sleep]]']);
  });

  it('cuts an unknown face out without acting on it', () => {
    expect(shape(stream(['a [[face flabbergasted]] b']))).toEqual(['a  b']);
  });

  it('a stream that ends mid-token releases it', () => {
    expect(shape(stream(['Bye [[face']))).toEqual(['Bye [[face']);
  });
});

describe('hasCues / speaking', () => {
  it('knows a message with cues', () => {
    expect(hasCues('hi [[pause]]')).toBe(true);
    expect(hasCues('hi [[face happy]]')).toBe(true);
    expect(hasCues('hi [[sleep]]')).toBe(false);
    expect(hasCues('hi [[pause]]')).toBe(true); // no lastIndex leak between calls
  });

  it('a pause is never spoken', () => {
    expect(speakableFromMrkdwn('One. [[pause 2s]] Two. [[pause]]')).toBe('One. Two.');
  });
});
