import { describe, expect, it } from '@jest/globals';
import { readDirective, wantsLook } from '../directives';
import { speakableFromMrkdwn } from '../speakable';

describe('readDirective', () => {
  it('finds sleep and wake', () => {
    expect(readDirective('Goodnight, Michael. [[sleep]]')).toBe('sleep');
    expect(readDirective('[[wake]] Morning!')).toBe('wake');
  });

  it('tolerates case and inner spaces', () => {
    expect(readDirective('[[ SLEEP ]]')).toBe('sleep');
  });

  it('is null for ordinary text, including single brackets', () => {
    expect(readDirective('I went to sleep early [sleep] last night')).toBeNull();
    expect(readDirective('')).toBeNull();
  });

  it('lets the last directive win', () => {
    expect(readDirective('[[wake]] actually, [[sleep]]')).toBe('sleep');
  });

  it('is stateless across calls despite the global regex', () => {
    for (let i = 0; i < 3; i++) expect(readDirective('ok [[sleep]]')).toBe('sleep');
  });
});

describe('look (ASC-43)', () => {
  it('is a request, never a sleep state', () => {
    expect(readDirective('Mind if I take a look? [[look]]')).toBeNull();
    expect(readDirective('[[wake]] can I see? [[look]]')).toBe('wake');
  });

  it('is found anywhere, in any case', () => {
    expect(wantsLook('Mind if I take a look? [[look]]')).toBe(true);
    expect(wantsLook('[[ LOOK ]] hi')).toBe(true);
  });

  it('is false for prose about looking and for other tokens', () => {
    expect(wantsLook('Let me look at your calendar.')).toBe(false);
    expect(wantsLook('[look] at this')).toBe(false);
    expect(wantsLook('Goodnight [[sleep]]')).toBe(false);
  });

  it('is stateless across calls despite the global regex', () => {
    for (let i = 0; i < 3; i++) expect(wantsLook('ok [[look]]')).toBe(true);
  });
});

describe('speakableFromMrkdwn strips directives', () => {
  it('never speaks the look token', () => {
    expect(speakableFromMrkdwn('Mind if I take a look? [[look]]')).toBe('Mind if I take a look?');
  });

  it('never speaks the token', () => {
    expect(speakableFromMrkdwn('Goodnight, Michael. [[sleep]]')).toBe('Goodnight, Michael.');
    expect(speakableFromMrkdwn('<@U0BNNMQS9CM> [[wake]] Morning!')).toBe('Morning!');
  });

  it('leaves a directive-only message empty', () => {
    expect(speakableFromMrkdwn('[[sleep]]')).toBe('');
  });
});
