import { describe, expect, it } from '@jest/globals';
import {
  band,
  DEFAULT_PERSONALITY,
  fromPreset,
  matchPreset,
  nextPreset,
  normalizePersonality,
  nudge,
  personalityLabel,
  PRESETS,
  TRAIT_KEYS,
} from '../traits';

describe('presets', () => {
  it('every preset sets every slider within range', () => {
    for (const p of PRESETS) {
      for (const k of TRAIT_KEYS) {
        expect(p.traits[k]).toBeGreaterThanOrEqual(0);
        expect(p.traits[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a preset is recognised by its slider positions alone', () => {
    for (const p of PRESETS) expect(matchPreset({ ...p.traits })).toBe(p.id);
  });

  it('defaults to the chief of staff', () => {
    expect(DEFAULT_PERSONALITY.preset).toBe('chief');
    expect(personalityLabel(DEFAULT_PERSONALITY)).toBe('chief of staff');
  });

  it('cycles through every preset and wraps, and a custom mix restarts the cycle', () => {
    let p = fromPreset(PRESETS[0].id);
    const seen = [p.preset];
    for (let i = 1; i < PRESETS.length; i++) {
      p = nextPreset(p);
      seen.push(p.preset);
    }
    expect(seen).toEqual(PRESETS.map((x) => x.id));
    expect(nextPreset(p).preset).toBe(PRESETS[0].id);
    expect(nextPreset({ preset: null, traits: p.traits }).preset).toBe(PRESETS[0].id);
  });
});

describe('nudge', () => {
  it('moves one slider a step and leaves the preset', () => {
    const p = nudge(fromPreset('chief'), 'sass', 1);
    expect(p.traits.sass).toBe(0.5);
    expect(p.preset).toBeNull();
    expect(personalityLabel(p)).toBe('custom');
  });

  it('clamps at the poles', () => {
    let p = fromPreset('sassy');
    p = nudge(nudge(p, 'sass', 1), 'sass', 1);
    expect(p.traits.sass).toBe(1);
    expect(nudge(fromPreset('zen'), 'sass', -1).traits.sass).toBe(0);
  });

  it('nudging there and back lands on the preset again, without float drift', () => {
    const p = nudge(nudge(fromPreset('dry'), 'humor', -1), 'humor', 1);
    expect(p.preset).toBe('dry');
  });
});

describe('normalizePersonality', () => {
  it('falls back to the default for anything unreadable', () => {
    expect(normalizePersonality(null)).toEqual(DEFAULT_PERSONALITY);
    expect(normalizePersonality('nope')).toEqual(DEFAULT_PERSONALITY);
  });

  it('keeps good sliders, clamps wild ones and fills missing ones', () => {
    const p = normalizePersonality({ traits: { humor: 3, sass: 'x', energy: 0.9 } });
    expect(p.traits.humor).toBe(1);
    expect(p.traits.sass).toBe(DEFAULT_PERSONALITY.traits.sass);
    expect(p.traits.energy).toBe(0.9);
  });

  it('re-derives the preset rather than trusting a stored one', () => {
    expect(normalizePersonality({ preset: 'zen', traits: fromPreset('sunny').traits }).preset).toBe('sunny');
  });
});

describe('band', () => {
  it('splits a slider in thirds', () => {
    expect(band(0)).toBe('low');
    expect(band(0.3)).toBe('low');
    expect(band(0.5)).toBe('mid');
    expect(band(0.7)).toBe('high');
  });
});
