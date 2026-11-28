import { describe, expect, it } from '@jest/globals';
import { speakableFromMrkdwn } from '../../round/speakable';
import { readDirective } from '../../round/directives';
import { fromPreset, PRESETS, TRAIT_KEYS, type Traits } from '../../personality/traits';
import {
  BASE_INTENSITY,
  EXPRESSIONS,
  expressionPose,
  expressionWeight,
  expressiveness,
  newFaceTokens,
  NEUTRAL,
  parseExpression,
  readFaceTokens,
  restingExpression,
  wear,
} from '../expression';
import { eyeGeo, EYE_CORNERS_LID, EYE_CORNERS_PLEASED } from '../geometry';
import { isSmiling, pickViseme } from '../visemes';

const NEVER = -9e9;
const flat = (v: number) => Object.fromEntries(TRAIT_KEYS.map((k) => [k, v])) as Traits;

describe('face tokens', () => {
  it('reads every expression by name, in order', () => {
    const raw = EXPRESSIONS.map((e) => `[[face ${e}]]`).join(' words ');
    expect(readFaceTokens(raw).map((t) => t.name)).toEqual(EXPRESSIONS);
  });

  it('accepts the separators the other tokens do, and any case', () => {
    expect(readFaceTokens('[[face: Amused]] [[FACE=happy]]').map((t) => t.name)).toEqual(['amused', 'happy']);
  });

  it('maps near-miss words onto a face rather than dropping them', () => {
    expect(parseExpression('smile')).toBe('happy');
    expect(parseExpression('worried')).toBe('concerned');
    expect(parseExpression('confused')).toBe('puzzled');
    expect(parseExpression('side-eye')).toBe('sideeye');
    expect(parseExpression('tired')).toBe('sleepy');
    expect(readFaceTokens('[[face flabbergasted]]')).toEqual([]);
  });

  it('reads a strength word or number', () => {
    const [soft, big, half, pct] = readFaceTokens(
      '[[face amused slightly]] [[face happy very]] [[face curious 0.5]] [[face curious 50%]]',
    );
    expect(soft.strength).toBeLessThan(1);
    expect(big.strength).toBeGreaterThan(1);
    expect(half.strength).toBe(0.5);
    expect(pct.strength).toBe(0.5);
  });

  it('is stripped before speaking, and is not a sleep or wake', () => {
    const raw = '[[face concerned]] That meeting moved. [[face thoughtful slightly]] Want me to rebook?';
    expect(speakableFromMrkdwn(raw)).toBe('That meeting moved. Want me to rebook?');
    expect(readDirective(raw)).toBeNull();
  });

  it('reports only the tokens that arrived since the last look, as a reply streams', () => {
    let text = 'Oh [[face surp';
    let r = newFaceTokens(text, 0);
    expect(r.tokens).toEqual([]);
    text += 'rised]] really? [[face amused]]';
    r = newFaceTokens(text, r.seen);
    expect(r.tokens.map((t) => t.name)).toEqual(['surprised', 'amused']);
    text += ' fine.';
    r = newFaceTokens(text, r.seen);
    expect(r.tokens).toEqual([]);
    expect(r.seen).toBe(2);
  });
});

describe('wearing an expression', () => {
  it('an energetic, warm personality wears it bigger than a calm, cool one', () => {
    expect(expressiveness(flat(1))).toBeGreaterThan(1);
    expect(expressiveness(flat(0))).toBeLessThan(1);
    const token = { name: 'amused' as const, strength: 1 };
    expect(wear(token, fromPreset('sunny').traits).intensity).toBeGreaterThan(wear(token, fromPreset('zen').traits).intensity);
  });

  it('stays within 0..1, and neutral is nothing at all', () => {
    expect(wear({ name: 'happy', strength: 9 }, flat(1)).intensity).toBe(1);
    expect(wear({ name: 'happy', strength: 0 }, flat(0)).intensity).toBeGreaterThan(0);
    expect(wear({ name: 'neutral', strength: 1 }, flat(1))).toEqual(NEUTRAL);
  });

  it('every expression but neutral has a strength', () => {
    for (const e of EXPRESSIONS) if (e !== 'neutral') expect(BASE_INTENSITY[e]).toBeGreaterThan(0);
  });
});

describe('restingExpression — no default smile', () => {
  it('the default personality rests neutral', () => {
    expect(restingExpression(fromPreset('chief').traits)).toEqual(NEUTRAL);
    expect(restingExpression(fromPreset('focused').traits)).toEqual(NEUTRAL);
    expect(restingExpression(fromPreset('zen').traits)).toEqual(NEUTRAL);
  });

  it('a happy, sassy or jokey one rests with happy eyes (ASC-64)', () => {
    for (const id of ['sunny', 'sassy', 'dry'] as const) {
      const rest = restingExpression(fromPreset(id).traits);
      expect(rest.name).toBe('happy');
      // Strong enough for the crescent eye, which needs more than half.
      expect(rest.intensity).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('no personality rests with a smile, in any quiet mode or speaking gap (ASC-64)', () => {
    for (const p of PRESETS) {
      const rest = restingExpression(p.traits);
      for (const mode of ['idle', 'resting'] as const) {
        expect(isSmiling(mode, null, rest)).toBe(false);
        expect(pickViseme(mode, 0, null, true, undefined, rest)).toBe('sil');
      }
      expect(isSmiling('speaking', null, rest, 'sil')).toBe(false);
    }
  });

  it('an explicit happy face still smiles', () => {
    const t = fromPreset('sunny').traits;
    expect(isSmiling('resting', null, wear({ name: 'happy', strength: 1 }, t))).toBe(true);
    expect(isSmiling('idle', null, wear({ name: 'amused', strength: 1 }, t))).toBe(true);
  });
});

describe('the mouth', () => {
  it('no longer smiles after a reply unless the expression is a smile', () => {
    expect(isSmiling('resting', null)).toBe(false);
    expect(isSmiling('resting', null, NEUTRAL)).toBe(false);
    expect(isSmiling('resting', null, { name: 'concerned', intensity: 1 })).toBe(false);
    expect(isSmiling('resting', null, { name: 'happy', intensity: 0.8 })).toBe(true);
    expect(isSmiling('idle', null, { name: 'amused', intensity: 0.6 })).toBe(true);
    expect(isSmiling('idle', null, { name: 'mischievous', intensity: 0.8 })).toBe(true);
    expect(isSmiling('idle', null, { name: 'sad', intensity: 1 })).toBe(false);
  });

  it('the pleased mode still smiles, for the overlay', () => {
    expect(isSmiling('pleased', null)).toBe(true);
  });

  it('while talking, smiles only where the mouth would be shut', () => {
    const happy = { name: 'happy' as const, intensity: 0.8 };
    expect(isSmiling('speaking', null, happy, 'sil')).toBe(true);
    expect(isSmiling('speaking', null, happy, 'AA')).toBe(false);
    expect(isSmiling('speaking', null, { name: 'happy', intensity: 0.3 }, 'sil')).toBe(false);
    expect(isSmiling('speaking', null, { name: 'concerned', intensity: 1 }, 'sil')).toBe(false);
    expect(isSmiling('speaking', null, NEUTRAL, 'sil')).toBe(false);
  });

  it('never replaces a speaking viseme or a frozen one', () => {
    const happy = { name: 'happy' as const, intensity: 1 };
    expect(isSmiling('speaking', null, happy, 'EE')).toBe(false);
    expect(isSmiling('resting', 'AA', happy)).toBe(false);
    expect(pickViseme('speaking', 0, null, true, 'EE', { name: 'surprised', intensity: 1 })).toBe('EE');
  });

  it('surprised rests on an oh and puzzled on confused’s mouth', () => {
    expect(pickViseme('idle', 0, null, true, undefined, { name: 'surprised', intensity: 0.8 })).toBe('OH');
    expect(pickViseme('resting', 0, null, true, undefined, { name: 'puzzled', intensity: 0.8 })).toBe('K');
    expect(pickViseme('idle', 0, null, true, undefined, { name: 'surprised', intensity: 0.3 })).toBe('sil');
  });
});

describe('eyes', () => {
  it('listening, thinking and alert are left alone', () => {
    for (const mode of ['listening', 'thinking', 'alert', 'confused', 'pleased'] as const) {
      expect(expressionWeight(mode)).toBe(0);
      expect(eyeGeo(1, 1000, mode, NEVER, NEVER, 0, 'surprised', 1)).toEqual(eyeGeo(1, 1000, mode, NEVER, NEVER));
    }
  });

  it('resting draws as idle when nothing is worn', () => {
    expect(eyeGeo(-1, 1234, 'resting', NEVER, NEVER)).toEqual(eyeGeo(-1, 1234, 'idle', NEVER, NEVER));
  });

  it('a fully worn happy is the design’s pleased pose over idle', () => {
    const p = eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'happy', 1);
    expect(p.sh).toBeCloseTo(0.52);
    expect(p.corners).toBe(EYE_CORNERS_PLEASED);
  });

  it('a faint one changes shape without taking the crescent', () => {
    const p = eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'happy', 0.3);
    expect(p.sh).toBeGreaterThan(0.52);
    expect(p.sh).toBeLessThan(1);
    expect(p.corners).not.toBe(EYE_CORNERS_PLEASED);
  });

  it('every expression has a pose that stays on screen', () => {
    for (const e of EXPRESSIONS) {
      for (const side of [-1, 1]) {
        const g = eyeGeo(side, 1234, 'idle', NEVER, NEVER, 0, e, 1);
        expect(g.sw).toBeGreaterThan(0.5);
        expect(g.sw).toBeLessThan(1.5);
        expect(g.sh).toBeGreaterThan(0.05);
        expect(g.sh).toBeLessThan(1.6);
        expect(Math.abs(g.x)).toBeLessThan(45);
        expect(Math.abs(g.y)).toBeLessThan(30);
        expect(Math.abs(g.r)).toBeLessThanOrEqual(20);
      }
    }
  });

  it('sad and angry slant the eyes in opposite directions, mirrored left to right', () => {
    const sadL = expressionPose('sad', -1).r;
    const sadR = expressionPose('sad', 1).r;
    const angryR = expressionPose('angry', 1).r;
    expect(sadL).toBe(-sadR);
    expect(Math.sign(sadR)).toBe(-Math.sign(angryR));
  });

  it('bored wears the lid, happy the crescent; a faint one neither', () => {
    expect(eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'bored', 1).corners).toBe(EYE_CORNERS_LID);
    expect(eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'excited', 1).corners).toBe(EYE_CORNERS_PLEASED);
    expect(eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'bored', 0.3).corners).not.toBe(EYE_CORNERS_LID);
  });

  it('a wink shuts one eye only', () => {
    expect(eyeGeo(-1, 0, 'idle', NEVER, NEVER, 0, 'wink', 1).sh).toBeLessThan(0.2);
    expect(eyeGeo(1, 0, 'idle', NEVER, NEVER, 0, 'wink', 1).sh).toBeGreaterThan(0.9);
  });

  it('asleep unwinds any slant', () => {
    expect(eyeGeo(1, 0, 'idle', NEVER, NEVER, 1, 'angry', 1).r).toBeCloseTo(0);
  });

  it('skeptical is lopsided', () => {
    expect(expressionPose('skeptical', -1).sh).toBeLessThan(1);
    expect(expressionPose('skeptical', 1).sh).toBeGreaterThan(1);
  });

  it('speaking keeps its pulse inside an expression', () => {
    const a = eyeGeo(1, 300, 'speaking', NEVER, NEVER, 0, 'curious', 1);
    const b = eyeGeo(1, 700, 'speaking', NEVER, NEVER, 0, 'curious', 1);
    expect(a.sh).not.toBeCloseTo(b.sh);
  });

  it('asleep still wins over any expression', () => {
    const p = eyeGeo(1, 0, 'idle', NEVER, NEVER, 1, 'surprised', 1);
    expect(p.sh).toBeLessThan(0.2);
  });
});
