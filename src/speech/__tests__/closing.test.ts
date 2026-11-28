import { describe, expect, it } from '@jest/globals';
import {
  BASE_WINDOW_MS,
  DECAY_AFTER,
  MAX_WINDOW_MS,
  MODEL_STRIKES,
  WINDOW_STEP_MS,
  describeLesson,
  freshMemory,
  learnFromClose,
  learnFromCorrection,
  parseMemory,
  readClosing,
  readCorrection,
  trustsModel,
  type ClosingMemory,
} from '../closing';

describe('readClosing', () => {
  it('reads a bare dismissal as closing without an answer', () => {
    expect(readClosing('Never mind.')).toEqual({ kind: 'dismiss', phrase: 'never mind' });
    expect(readClosing("Okay, that's all")).toEqual({ kind: 'dismiss', phrase: "that's all" });
    expect(readClosing('nothing')).toEqual({ kind: 'dismiss', phrase: 'nothing' });
    expect(readClosing('Stop listening, Eva')).toEqual({ kind: 'dismiss', phrase: 'stop listening' });
  });

  it('reads thanks and goodbyes as farewells, which still get an answer', () => {
    expect(readClosing('Thanks!')).toEqual({ kind: 'farewell', phrase: 'thanks' });
    expect(readClosing('Perfect, thank you so much Eva')).toEqual({ kind: 'farewell', phrase: 'thank you' });
    expect(readClosing('Goodnight')).toEqual({ kind: 'farewell', phrase: 'goodnight' });
    expect(readClosing('Okay cool, see you later')).toEqual({ kind: 'farewell', phrase: 'see you later' });
    expect(readClosing('Thank you very much')).toEqual({ kind: 'farewell', phrase: 'thank you very much' });
  });

  it('lets a farewell win over a dismissal in the same breath', () => {
    expect(readClosing("That's all, thanks")).toEqual({ kind: 'farewell', phrase: 'thanks' });
  });

  it('handles curly apostrophes', () => {
    expect(readClosing('That’s it')).toEqual({ kind: 'dismiss', phrase: "that's it" });
  });

  it('never closes on a question', () => {
    expect(readClosing("Thanks, and what's on tomorrow?")).toBeNull();
    expect(readClosing('Thank you for the reminder, can you move it to Friday')).toBeNull();
    expect(readClosing("That's all the tasks for today?")).toBeNull();
    expect(readClosing('Nothing on my calendar tomorrow?')).toBeNull();
    expect(readClosing('Good night or good morning in Tokyo right now')).toBeNull();
  });

  it('needs a closer — filler alone is not one', () => {
    expect(readClosing('Okay')).toBeNull();
    expect(readClosing('Great, cool')).toBeNull();
    expect(readClosing('')).toBeNull();
    expect(readClosing('   ...  ')).toBeNull();
  });

  it('skips a demoted phrase without turning the rest into a question', () => {
    expect(readClosing('Okay thanks', ['thanks'])).toBeNull();
    expect(readClosing('Thanks, bye', ['thanks'])).toEqual({ kind: 'farewell', phrase: 'bye' });
  });
});

describe('readCorrection', () => {
  it('reads "I wasn\'t done" and its cousins', () => {
    for (const t of [
      "I wasn't done",
      'I wasn’t finished',
      "I'm not done",
      'I am not finished yet',
      'Wait, I was still talking',
      'No, you cut me off',
      'Hey Eva, come back',
      'not done yet',
    ]) {
      expect(readCorrection(t)).toEqual({ rest: '' });
    }
  });

  it('keeps what follows, so a correction can also ask', () => {
    expect(readCorrection("I wasn't done — what about Friday?")).toEqual({ rest: 'what about Friday?' });
    expect(readCorrection("Wait I'm not done, add milk too")).toEqual({ rest: 'add milk too' });
  });

  it('is null for ordinary questions', () => {
    expect(readCorrection("I'm not done with the report, when is it due?")).toBeNull();
    expect(readCorrection('Is the laundry done?')).toBeNull();
    expect(readCorrection('Come back to that later')).toBeNull();
    expect(readCorrection("What's the weather")).toBeNull();
  });
});

describe('learning', () => {
  it('lengthens the window when a silence-close is corrected, up to a cap', () => {
    let m = freshMemory();
    m = learnFromCorrection(m, { kind: 'silence' });
    expect(m.windowMs).toBe(BASE_WINDOW_MS + WINDOW_STEP_MS);
    for (let i = 0; i < 10; i++) m = learnFromCorrection(m, { kind: 'silence' });
    expect(m.windowMs).toBe(MAX_WINDOW_MS);
    expect(describeLesson({ kind: 'silence' }, m)).toMatch(/22s/);
  });

  it('shrinks the window back after a run of uncorrected silence-closes, never below base', () => {
    let m: ClosingMemory = { ...freshMemory(), windowMs: BASE_WINDOW_MS + 2_000 };
    for (let i = 0; i < DECAY_AFTER - 1; i++) m = learnFromClose(m, { kind: 'silence' });
    expect(m.windowMs).toBe(BASE_WINDOW_MS + 2_000);
    m = learnFromClose(m, { kind: 'silence' });
    expect(m.windowMs).toBe(BASE_WINDOW_MS + 1_000);
    for (let i = 0; i < DECAY_AFTER * 5; i++) m = learnFromClose(m, { kind: 'silence' });
    expect(m.windowMs).toBe(BASE_WINDOW_MS);
  });

  it('a correction restarts the uncorrected run', () => {
    let m = freshMemory();
    for (let i = 0; i < DECAY_AFTER - 1; i++) m = learnFromClose(m, { kind: 'silence' });
    m = learnFromCorrection(m, { kind: 'silence' });
    expect(m.quietSilence).toBe(0);
  });

  it('demotes a corrected phrase, once', () => {
    let m = learnFromCorrection(freshMemory(), { kind: 'phrase', phrase: 'thanks' });
    m = learnFromCorrection(m, { kind: 'phrase', phrase: 'thanks' });
    expect(m.demoted).toEqual(['thanks']);
    expect(readClosing('thanks', m.demoted)).toBeNull();
  });

  it('stops trusting [[done]] after repeated corrections, and earns it back', () => {
    let m = freshMemory();
    for (let i = 0; i < MODEL_STRIKES - 1; i++) m = learnFromCorrection(m, { kind: 'model' });
    expect(trustsModel(m)).toBe(true);
    m = learnFromCorrection(m, { kind: 'model' });
    expect(trustsModel(m)).toBe(false);
    expect(describeLesson({ kind: 'model' }, m)).toMatch(/no longer/);
    for (let i = 0; i < DECAY_AFTER; i++) m = learnFromClose(m, { kind: 'model' });
    expect(trustsModel(m)).toBe(true);
  });

  it('phrase closes teach nothing on their own', () => {
    const m = freshMemory();
    expect(learnFromClose(m, { kind: 'phrase', phrase: 'bye' })).toBe(m);
  });
});

describe('parseMemory', () => {
  it('round-trips', () => {
    const m = learnFromCorrection(learnFromCorrection(freshMemory(), { kind: 'silence' }), { kind: 'phrase', phrase: 'bye' });
    expect(parseMemory(JSON.stringify(m))).toEqual(m);
  });

  it('falls back to fresh on missing, garbled or foreign data', () => {
    expect(parseMemory(null)).toEqual(freshMemory());
    expect(parseMemory('{nope')).toEqual(freshMemory());
    expect(parseMemory('{"v":2}')).toEqual(freshMemory());
  });

  it('clamps a stored window into range', () => {
    expect(parseMemory('{"v":1,"windowMs":999999}').windowMs).toBe(MAX_WINDOW_MS);
    expect(parseMemory('{"v":1,"windowMs":1}').windowMs).toBe(BASE_WINDOW_MS);
  });
});
