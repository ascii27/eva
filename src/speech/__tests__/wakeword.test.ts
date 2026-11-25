import { describe, expect, it } from '@jest/globals';
import { findNearMiss, findNearMissIn, findWake, findWakeIn, normalizeWake, TAIL_WINDOW } from '../wakeword';

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

describe('greetings other than hey (ASC-37)', () => {
  it('wakes on hi, hello, hiya and hallo', () => {
    expect(findWake('hi eva')).not.toBeNull();
    expect(findWake('Hello, Eva!')).not.toBeNull();
    expect(findWake('hiya ava')).not.toBeNull();
    expect(findWake('hallo eva')).not.toBeNull();
  });

  it('still needs a greeting followed by Eva', () => {
    expect(findWake('hi there')).toBeNull();
    expect(findWake('hello evan')).toBeNull();
    expect(findWake('hello everyone')).toBeNull();
    expect(findWake('chi eva')).toBeNull();
  });
});

describe('findWakeIn', () => {
  it('wakes when only a later alternative heard the phrase', () => {
    expect(findWakeIn(['heavy a', 'hey eva'])).not.toBeNull();
  });

  it('is null for no alternatives or no match', () => {
    expect(findWakeIn([])).toBeNull();
    expect(findWakeIn(['heavy a', 'hey everyone'])).toBeNull();
  });
});

describe('findNearMiss', () => {
  it('flags a greeting followed by a vowel-initial word', () => {
    expect(findNearMiss('hey ever')).not.toBeNull();
    expect(findNearMiss('hi even')).not.toBeNull();
  });

  it('flags an Eva-like word without a greeting', () => {
    expect(findNearMiss('ask ava about it')).not.toBeNull();
    expect(findNearMiss('eva')).not.toBeNull();
  });

  it('is null for a real wake or for unrelated speech', () => {
    expect(findNearMiss('hey eva')).toBeNull();
    expect(findNearMiss('hi there')).toBeNull();
    expect(findNearMiss('evaluate this')).toBeNull();
    expect(findNearMiss('')).toBeNull();
  });

  it('returns null across alternatives when any of them wakes', () => {
    expect(findNearMissIn(['hey ever', 'hey eva'])).toBeNull();
    expect(findNearMissIn(['hey ever', 'heavier'])).not.toBeNull();
    expect(findNearMissIn([])).toBeNull();
  });
});
