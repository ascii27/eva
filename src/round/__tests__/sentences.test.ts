import { describe, expect, it } from '@jest/globals';
import { emptySentences, flushPending, MAX_PENDING_CHARS, pushText, SENTENCE_END } from '../sentences';

/** Feed deltas in order, collecting every sentence emitted along the way. */
function feed(...deltas: string[]): { sentences: string[]; tail: string } {
  let state = emptySentences();
  const sentences: string[] = [];
  for (const d of deltas) {
    const r = pushText(state, d);
    state = r.state;
    sentences.push(...r.sentences);
  }
  return { sentences, tail: flushPending(state) };
}

describe('SENTENCE_END', () => {
  // Must equal Kokoro's kEndOfSentenceCharacters (Constants.h) so every push
  // lands on a boundary its native partitioner accepts immediately.
  it("matches Kokoro's end-of-sentence set", () => {
    for (const ch of ['.', '?', '!', ';', '…']) expect(SENTENCE_END).toContain(ch);
  });
});

describe('pushText', () => {
  it('emits a sentence once its terminator is followed by more text', () => {
    expect(feed('Hello there. How are you?', ' Fine.').sentences).toEqual([
      'Hello there.',
      'How are you?',
    ]);
  });

  it('holds a terminator that is still the last character', () => {
    // More could follow ("Hello." vs "Hello..."), so it waits.
    const { sentences, tail } = feed('Hello.');
    expect(sentences).toEqual([]);
    expect(tail).toBe('Hello.');
  });

  it('reassembles a sentence split across deltas', () => {
    expect(feed('Hello ther', 'e. Next').sentences).toEqual(['Hello there.']);
  });

  it('flattens markdown that spans two deltas', () => {
    // The whole point of buffering: speakableFromMrkdwn cannot unwrap half a
    // bold span, so flattening happens only once a sentence is complete.
    expect(feed('This is **rea', 'lly** important. Next').sentences).toEqual([
      'This is really important.',
    ]);
  });

  it('speaks a markdown link label and drops its url', () => {
    expect(feed('See [the doc](https://example.com/x). Next').sentences).toEqual(['See the doc.']);
  });

  it('does not split a decimal number', () => {
    expect(feed('It costs 3.50 dollars. Okay').sentences).toEqual(['It costs 3.50 dollars.']);
  });

  it('splits on every terminator in the set', () => {
    expect(feed('One. Two? Three! Four; End').sentences).toEqual(['One.', 'Two?', 'Three!', 'Four;']);
  });

  it('force-flushes at a word boundary once pending grows too long', () => {
    const long = 'word '.repeat(60); // 300 chars, no terminator
    const { sentences } = feed(long);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences[0].length).toBeLessThanOrEqual(MAX_PENDING_CHARS);
    expect(sentences[0].endsWith('word')).toBe(true);
  });

  it('keeps holding a single enormous unbroken token', () => {
    // No space to cut at; emitting a fragment mid-word would be worse.
    expect(feed('x'.repeat(MAX_PENDING_CHARS + 50)).sentences).toEqual([]);
  });

  it('emits nothing for whitespace-only input', () => {
    expect(feed('   ', '\n\n').sentences).toEqual([]);
  });

  it('does not mutate the state passed to it', () => {
    const before = emptySentences();
    pushText(before, 'Hello. ');
    expect(before.pending).toBe('');
  });
});

describe('flushPending', () => {
  it('returns the flattened remainder', () => {
    let state = emptySentences();
    state = pushText(state, 'Done. And **one** more thing').state;
    expect(flushPending(state)).toBe('And one more thing');
  });

  it('is empty when nothing is pending', () => {
    expect(flushPending(emptySentences())).toBe('');
  });
});
