import { describe, expect, it } from '@jest/globals';
import { findWake, normalizeWake, TAIL_WINDOW } from '../wakeword';

describe('normalizeWake', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWake('Hey, Eva!')).toBe('hey eva');
    expect(normalizeWake("Hey Eva's calendar…")).toBe('hey evas calendar');
  });

  it('collapses whitespace runs', () => {
    expect(normalizeWake('hey \n  eva   there')).toBe('hey eva there');
  });
});

describe('findWake', () => {
  it('matches the canonical phrase in any case', () => {
    expect(findWake('Hey Eva')).not.toBeNull();
    expect(findWake('HEY EVA')).not.toBeNull();
    expect(findWake('hey eva')).not.toBeNull();
  });

  it('matches with punctuation between and after the words', () => {
    expect(findWake('Hey, Eva!')).not.toBeNull();
    expect(findWake('Hey Eva.')).not.toBeNull();
    expect(findWake('hey eva…')).not.toBeNull();
  });

  it('matches recognizer mishearings of the phrase', () => {
    expect(findWake('hey ava')).not.toBeNull();
    expect(findWake('hay eva')).not.toBeNull();
    expect(findWake('heyva')).not.toBeNull();
    expect(findWake('hey iva')).not.toBeNull();
    expect(findWake('hey evah')).not.toBeNull();
    expect(findWake("Hey Eva's calendar")).not.toBeNull();
  });

  it('matches mid-sentence', () => {
    expect(findWake('so anyway hey eva can you hear me')).not.toBeNull();
  });

  it('matches at the tail of a long transcript', () => {
    const filler = 'the quick brown fox jumps over the lazy dog '.repeat(6);
    expect(filler.length).toBeGreaterThan(200);
    expect(findWake(`${filler}hey eva`)).not.toBeNull();
  });

  it('rejects near-misses and unrelated speech', () => {
    expect(findWake('hey evan')).toBeNull();
    expect(findWake('hey everyone')).toBeNull();
    expect(findWake('evaluate this')).toBeNull();
    expect(findWake('heavy evaluation')).toBeNull();
    expect(findWake('eva')).toBeNull();
    expect(findWake('ava')).toBeNull();
    expect(findWake('they evade capture')).toBeNull();
    expect(findWake('')).toBeNull();
  });

  it('only scans the tail window of the normalized transcript', () => {
    const buried = `hey eva ${'x'.repeat(TAIL_WINDOW)}`;
    expect(findWake(buried)).toBeNull();
  });

  it('does not fabricate a word boundary when the window cuts a word', () => {
    // Sliced exactly at the "t" of "they", the tail would read "hey ava said …"
    // — the window must recede to a true word start instead of matching it.
    const aligned = `some earlier words then they ava said ${'x'.repeat(47)}`;
    expect(findWake(aligned)).toBeNull();
  });

  it('returns a snippet containing the matched phrase with context', () => {
    const m = findWake('I was thinking hey eva what time is it');
    expect(m).not.toBeNull();
    expect(m!.snippet).toContain('hey eva');
    expect(m!.snippet).toContain('thinking');
  });
});
