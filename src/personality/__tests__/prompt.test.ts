import { describe, expect, it } from '@jest/globals';
import { EXPRESSIONS } from '../../face/expression';
import { readFaceTokens } from '../../face/expression';
import { speakableFromMrkdwn } from '../../round/speakable';
import { CLOSING_RULES, DESK_RULES, FACE_RULES, personaWith, personalityPrompt } from '../prompt';
import { fromPreset, TRAIT_KEYS, type Personality } from '../traits';

const middle: Personality = {
  preset: null,
  traits: Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0.5])) as Personality['traits'],
};

describe('personalityPrompt', () => {
  it('says nothing for a personality with no leanings', () => {
    expect(personalityPrompt(middle)).toBe('');
  });

  it('names the preset and only the sliders that lean', () => {
    const text = personalityPrompt(fromPreset('sassy'));
    expect(text).toContain('(sassy)');
    expect(text).toMatch(/sassy: tease him/);
    expect(text).not.toMatch(/no jokes/);
  });

  it('opposite presets read differently', () => {
    expect(personalityPrompt(fromPreset('focused'))).toMatch(/no jokes/);
    expect(personalityPrompt(fromPreset('sunny'))).toMatch(/warm/);
  });

  it('only suggests faces that exist', () => {
    for (const id of ['chief', 'sunny', 'dry', 'sassy', 'zen', 'focused'] as const) {
      const lean = /Your face leans ([^.]+)\./.exec(personalityPrompt(fromPreset(id)));
      for (const f of lean?.[1].split(', ') ?? []) expect(EXPRESSIONS).toContain(f);
    }
  });
});

describe('FACE_RULES', () => {
  it('names every face, its example tokens parse, and none of them is spoken', () => {
    for (const e of EXPRESSIONS) expect(FACE_RULES).toMatch(new RegExp(`\\b${e}\\b`));
    expect(readFaceTokens(FACE_RULES).length).toBeGreaterThan(0);
    expect(speakableFromMrkdwn(FACE_RULES)).not.toMatch(/\[\[/);
  });
});

describe('CLOSING_RULES', () => {
  it('teaches [[done]], which is stripped from speech, and rides with the face rules', () => {
    expect(CLOSING_RULES).toMatch(/\[\[done\]\]/);
    expect(speakableFromMrkdwn(CLOSING_RULES)).not.toMatch(/\[\[/);
    expect(personaWith('BASE', fromPreset('sassy'))).toContain(CLOSING_RULES);
  });
});

describe('personaWith', () => {
  it('appends the face rules, then the personality', () => {
    const out = personaWith('BASE', fromPreset('sassy'));
    expect(out.startsWith('BASE\n\n')).toBe(true);
    expect(out.indexOf(FACE_RULES)).toBeLessThan(out.indexOf('Your personality'));
  });

  it('is stable for the same personality, so the cached prefix survives', () => {
    expect(personaWith('BASE', fromPreset('dry'))).toBe(personaWith('BASE', fromPreset('dry')));
  });

  it('carries no personality paragraph when nothing leans', () => {
    expect(personaWith('BASE', middle)).toBe(`BASE\n\n${DESK_RULES}`);
  });
});
