import { describe, expect, it } from '@jest/globals';
import { readWatchCommand, watchReply } from '../command';

describe('readWatchCommand', () => {
  it.each([
    'Stop watching',
    'eva stop watching me',
    'please stop looking at me',
    'turn off the camera',
    'turn the camera off',
    'no more watching, okay?',
    'Quit watching.',
  ])('"%s" is a stop', (text) => {
    expect(readWatchCommand(text)).toBe('stop');
  });

  it.each(['start watching', 'you can watch again', 'turn the camera back on', 'resume watching', "don't stop watching"])(
    '"%s" is a start',
    (text) => {
      expect(readWatchCommand(text)).toBe('start');
    },
  );

  it.each([
    'what are you watching on tv tonight',
    'stop looking it up',
    'can you keep looking for my keys',
    'take a photo with the camera',
    'what time is it',
  ])('"%s" is not a command', (text) => {
    expect(readWatchCommand(text)).toBeNull();
  });
});

describe('watchReply', () => {
  it('says what happened, or that it cannot', () => {
    expect(watchReply('stop', true)).toMatch(/stopped watching/);
    expect(watchReply('start', true)).toMatch(/watching/);
    expect(watchReply('start', false)).toMatch(/can't/);
  });
});
