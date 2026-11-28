import { describe, expect, it } from '@jest/globals';
import { personalityReply, readPersonalityCommand } from '../command';

describe('readPersonalityCommand', () => {
  it.each([
    ['be more sassy', 'sass', 1],
    ['Eva, be a bit more sassy.', 'sass', 1],
    ['hey eva be sassier', 'sass', 1],
    ['can you be less sassy', 'sass', -1],
    ['be gentler', 'sass', -1],
    ['be funnier', 'humor', 1],
    ['be more serious', 'humor', -1],
    ['could you please be a little warmer', 'warmth', 1],
    ['be more professional', 'warmth', -1],
    ['be calmer', 'energy', -1],
    ['tone it down', 'energy', -1],
    ['i want you to be more upbeat', 'energy', 1],
    ['be less chatty', 'chattiness', -1],
    ['be more concise', 'chattiness', -1],
    ['be more curious', 'curiosity', 1],
    ['be more matter of fact', 'curiosity', -1],
    ['be more laid-back', 'energy', -1],
  ])('"%s" nudges %s %d', (text, trait, dir) => {
    expect(readPersonalityCommand(text)).toEqual({ kind: 'nudge', trait, dir });
  });

  it.each([
    ['switch to sunny personality', 'sunny'],
    ['eva switch to your dry wit personality', 'dry'],
    ['use the sassy personality', 'sassy'],
    ['go zen mode', 'zen'],
    ['change to all business mode', 'focused'],
    ['go back to your normal self', 'chief'],
    ['be your usual self', 'chief'],
    ['go back to normal', 'chief'],
  ])('"%s" picks %s', (text, id) => {
    expect(readPersonalityCommand(text)).toEqual({ kind: 'preset', id });
  });

  it('answers what personality she is on', () => {
    expect(readPersonalityCommand('what personality are you using')).toEqual({ kind: 'query' });
  });

  it.each([
    'what is on my calendar',
    'can you make this email more concise',
    'remind me to be more concise in meetings',
    "it's been a funny day",
    'is it warm outside',
    'switch to the calendar view',
    'be quiet',
  ])('"%s" is not a personality command', (text) => {
    // "be quiet" is a request to stop talking, not to change temperament.
    expect(readPersonalityCommand(text)).toBeNull();
  });
});

describe('personalityReply', () => {
  it('says which way it moved', () => {
    expect(personalityReply({ kind: 'nudge', trait: 'sass', dir: 1 }, 'custom')).toBe('Okay — a bit more sassy.');
    expect(personalityReply({ kind: 'nudge', trait: 'sass', dir: -1 }, 'custom')).toBe('Okay — a bit more gentle.');
  });

  it('owns up when a slider is already at its end', () => {
    expect(personalityReply({ kind: 'nudge', trait: 'sass', dir: 1 }, 'custom', true)).toBe("That's as sassy as I go.");
  });

  it('names the preset', () => {
    expect(personalityReply({ kind: 'preset', id: 'dry' }, 'dry wit')).toBe('Okay — dry wit it is.');
    expect(personalityReply({ kind: 'query' }, 'sunny')).toBe("I'm on sunny at the moment.");
  });
});
