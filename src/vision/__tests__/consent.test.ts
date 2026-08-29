import { describe, expect, it } from '@jest/globals';
import { CONSENT_QUESTION, CONSENT_RETRY, readConsent } from '../consent';

describe('readConsent', () => {
  describe('yes', () => {
    it.each([
      'yes',
      'Yes.',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'go ahead',
      'yeah go ahead',
      'sure, go for it',
      'do it',
      'please do',
      'fine',
      'of course',
      'yes please take a look',
    ])('reads %p as yes', (heard) => {
      expect(readConsent(heard)).toBe('yes');
    });
  });

  describe('no', () => {
    it.each([
      'no',
      'No!',
      'nope',
      'no thanks',
      'not now',
      "don't",
      'do not',
      'stop',
      'wait',
      'hold on',
      'never mind',
      'not right now',
      'no, don’t do it',
    ])('reads %p as no', (heard) => {
      expect(readConsent(heard)).toBe('no');
    });

    // The whole point of the gate. A refusal that contains an affirmative
    // token ("do", "ok") must never be heard as permission to open the lens.
    it('lets a refusal beat an affirmative token inside it', () => {
      expect(readConsent("no, don't do it")).toBe('no');
      expect(readConsent('not ok')).toBe('no');
      expect(readConsent('no, go away')).toBe('no');
    });
  });

  describe('unclear', () => {
    it.each([
      '',
      '   ',
      'what',
      'hang on what are you doing',
      'the meeting moved to one thirty',
      'why',
    ])('reads %p as unclear', (heard) => {
      expect(readConsent(heard)).toBe('unclear');
    });

    // Silence is the common case: the STT session ends with nothing at all.
    it('treats silence as unclear, never as consent', () => {
      expect(readConsent('')).toBe('unclear');
    });
  });

  it('ignores case, punctuation and surrounding noise', () => {
    expect(readConsent('  YES!! ')).toBe('yes');
    expect(readConsent('uh, yeah — go ahead')).toBe('yes');
  });

  // Substring matching would read "yes" out of "eyes" and "no" out of "know",
  // both of which are ordinary words in a room Eva is listening to.
  it('matches whole words, not substrings', () => {
    expect(readConsent('my eyes hurt')).toBe('unclear');
    expect(readConsent('I know')).toBe('unclear');
    expect(readConsent('nobody is here')).toBe('unclear');
  });
});

describe('the spoken questions', () => {
  // Consent you cannot hear is not consent: these are what gets spoken when
  // the model skips its preamble, so they have to be real questions.
  it('are non-empty and end in a question mark', () => {
    expect(CONSENT_QUESTION.trim()).not.toBe('');
    expect(CONSENT_QUESTION.trim().endsWith('?')).toBe(true);
    expect(CONSENT_RETRY.trim().endsWith('?')).toBe(true);
  });

  it('asks something shorter the second time', () => {
    expect(CONSENT_RETRY.length).toBeLessThan(CONSENT_QUESTION.length);
  });
});
