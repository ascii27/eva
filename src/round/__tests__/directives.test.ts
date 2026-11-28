import { describe, expect, it } from '@jest/globals';
import {
  asksForBattery,
  asksForLight,
  asksForLocation,
  endsConversation,
  readBrightness,
  readDirective,
  wantsLook,
} from '../directives';
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

describe('[[battery]] request', () => {
  it('is recognised, tolerating case and spaces, and is stateless', () => {
    expect(asksForBattery('<@U1> [[battery]]')).toBe(true);
    expect(asksForBattery('[[ Battery ]]')).toBe(true);
    expect(asksForBattery('[[ Battery ]]')).toBe(true);
    expect(asksForBattery('how is the battery?')).toBe(false);
  });

  it('is not a face directive', () => {
    expect(readDirective('[[battery]]')).toBeNull();
  });

  it('is never spoken', () => {
    expect(speakableFromMrkdwn('<@U1> [[battery]]')).toBe('');
    expect(speakableFromMrkdwn('Quick check. [[battery]]')).toBe('Quick check.');
  });
});

describe('[[light]] request', () => {
  it('finds it, case and spaces aside', () => {
    expect(asksForLight('<@U1> [[light]]')).toBe(true);
    expect(asksForLight('[[ Light ]]')).toBe(true);
    expect(asksForLight('is the light on?')).toBe(false);
  });

  it('is never spoken', () => {
    expect(speakableFromMrkdwn('<@U1> [[light]]')).toBe('');
  });
});

describe('readBrightness', () => {
  it('reads a bare token as a read, and a number as a set', () => {
    expect(readBrightness('[[brightness]]')).toEqual({ kind: 'read' });
    expect(readBrightness('Dimming it now. [[brightness 20]]')).toEqual({ kind: 'set', percent: 20 });
    expect(readBrightness('[[ Brightness: 35% ]]')).toEqual({ kind: 'set', percent: 35 });
    expect(readBrightness('[[brightness=0]]')).toEqual({ kind: 'set', percent: 0 });
  });

  it('flags a level that is not a percent rather than ignoring it', () => {
    expect(readBrightness('[[brightness 150]]')).toEqual({ kind: 'invalid' });
    expect(readBrightness('[[brightness dim]]')).toEqual({ kind: 'invalid' });
  });

  it('takes the last one, and nothing without a token', () => {
    expect(readBrightness('[[brightness 80]] no wait [[brightness 10]]')).toEqual({ kind: 'set', percent: 10 });
    expect(readBrightness('turn the brightness down')).toBeNull();
  });

  it('is never spoken, in any form', () => {
    expect(speakableFromMrkdwn('Done. [[brightness 20]]')).toBe('Done.');
    expect(speakableFromMrkdwn('[[ brightness: 35% ]] Dimmer now.')).toBe('Dimmer now.');
    expect(speakableFromMrkdwn('<@U1> [[brightness]]')).toBe('');
  });

  it('does not disturb sleep and wake', () => {
    expect(readDirective('[[brightness 5]] [[sleep]]')).toBe('sleep');
    expect(readBrightness('[[sleep]]')).toBeNull();
  });
});

describe('asksForLocation', () => {
  it('finds a location request', () => {
    expect(asksForLocation('<@U1> [[location]]')).toBe(true);
    expect(asksForLocation('[[ Location ]] please')).toBe(true);
  });

  it('is false for ordinary text and for other tokens', () => {
    expect(asksForLocation('what location is that?')).toBe(false);
    expect(asksForLocation('[[sleep]] [[look]] [[battery]]')).toBe(false);
  });

  it('is not a sleep/wake directive', () => {
    expect(readDirective('[[location]]')).toBeNull();
  });

  it('is never spoken', () => {
    expect(speakableFromMrkdwn('Quick one. [[location]]')).toBe('Quick one.');
    expect(speakableFromMrkdwn('[[location]]')).toBe('');
  });
});

describe('endsConversation', () => {
  it('finds [[done]] anywhere, in any case', () => {
    expect(endsConversation('Night, Michael. [[done]]')).toBe(true);
    expect(endsConversation('[[ DONE ]]')).toBe(true);
    expect(endsConversation('Sure. [[sleep]] [[done]]')).toBe(true);
  });

  it('is false without it', () => {
    expect(endsConversation("I'm done with the report draft.")).toBe(false);
    expect(endsConversation('[[sleep]]')).toBe(false);
  });

  it('is stripped from speech, and is not a sleep directive', () => {
    expect(speakableFromMrkdwn('Anytime. [[done]]')).toBe('Anytime.');
    expect(speakableFromMrkdwn('[[done]]')).toBe('');
    expect(readDirective('Bye! [[done]]')).toBeNull();
  });
});
