// Eva's personality (ASC-59) — pure, no React, unit-tested.
//
// A personality is six sliders. A preset is nothing more than saved slider
// positions, so "be a bit more sassy" from a preset simply leaves it as a
// custom mix rather than needing a seventh concept. Every slider runs 0 … 1
// from its left pole to its right one; 0.5 is "no particular lean", and a
// slider in the middle band says nothing at all in the prompt, so a balanced
// personality costs no words.

export type TraitKey = 'humor' | 'warmth' | 'sass' | 'energy' | 'chattiness' | 'curiosity';

export type Traits = Record<TraitKey, number>;

export const TRAIT_KEYS: TraitKey[] = ['humor', 'warmth', 'sass', 'energy', 'chattiness', 'curiosity'];

/** Each slider's poles, low first — for the overlay and for spoken replies. */
export const TRAIT_POLES: Record<TraitKey, [low: string, high: string]> = {
  humor: ['serious', 'funny'],
  warmth: ['cool', 'warm'],
  sass: ['gentle', 'sassy'],
  energy: ['calm', 'energetic'],
  chattiness: ['terse', 'chatty'],
  curiosity: ['matter-of-fact', 'curious'],
};

export type PresetId = 'chief' | 'sunny' | 'dry' | 'sassy' | 'zen' | 'focused';

export interface Preset {
  id: PresetId;
  /** What she and the overlay call it. */
  label: string;
  traits: Traits;
}

// "chief" is roughly who she has been all along — the persona's terse chief of
// staff — so the default personality mostly restates what PERSONA already says.
export const PRESETS: Preset[] = [
  { id: 'chief', label: 'chief of staff', traits: { humor: 0.35, warmth: 0.55, sass: 0.25, energy: 0.45, chattiness: 0.25, curiosity: 0.4 } },
  { id: 'sunny', label: 'sunny', traits: { humor: 0.7, warmth: 0.9, sass: 0.1, energy: 0.8, chattiness: 0.6, curiosity: 0.7 } },
  { id: 'dry', label: 'dry wit', traits: { humor: 0.8, warmth: 0.35, sass: 0.6, energy: 0.3, chattiness: 0.2, curiosity: 0.4 } },
  { id: 'sassy', label: 'sassy', traits: { humor: 0.7, warmth: 0.5, sass: 0.95, energy: 0.7, chattiness: 0.5, curiosity: 0.5 } },
  { id: 'zen', label: 'calm', traits: { humor: 0.2, warmth: 0.7, sass: 0, energy: 0.1, chattiness: 0.2, curiosity: 0.35 } },
  { id: 'focused', label: 'all business', traits: { humor: 0.05, warmth: 0.3, sass: 0.1, energy: 0.4, chattiness: 0, curiosity: 0.15 } },
];

export const DEFAULT_PRESET: PresetId = 'chief';

export interface Personality {
  /** The preset these sliders still match exactly, or null once nudged off it. */
  preset: PresetId | null;
  traits: Traits;
}

/** One voice nudge ("a bit more sassy") moves a slider this far. */
export const NUDGE_STEP = 0.25;

export function presetById(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function fromPreset(id: PresetId): Personality {
  const p = presetById(id);
  return { preset: p.id, traits: { ...p.traits } };
}

export const DEFAULT_PERSONALITY: Personality = fromPreset(DEFAULT_PRESET);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
// Two decimals is plenty for a slider and keeps repeated nudges from drifting
// into 0.30000000000000004, which would stop matching a preset by accident.
const tidy = (n: number) => Math.round(clamp01(n) * 100) / 100;

/** The preset these traits match exactly, or null. */
export function matchPreset(traits: Traits): PresetId | null {
  const hit = PRESETS.find((p) => TRAIT_KEYS.every((k) => Math.abs(p.traits[k] - traits[k]) < 0.005));
  return hit?.id ?? null;
}

/** Move one slider toward its high (+1) or low (-1) pole. */
export function nudge(p: Personality, trait: TraitKey, dir: 1 | -1, step = NUDGE_STEP): Personality {
  const traits = { ...p.traits, [trait]: tidy(p.traits[trait] + dir * step) };
  return { preset: matchPreset(traits), traits };
}

/** The next preset in the list, for the overlay's cycle button. */
export function nextPreset(p: Personality): Personality {
  const i = p.preset ? PRESETS.findIndex((x) => x.id === p.preset) : -1;
  return fromPreset(PRESETS[(i + 1) % PRESETS.length].id);
}

/**
 * Whatever came back from storage, made safe. Anything missing or malformed
 * falls back to the default rather than throwing — a bad file must never
 * leave her without a personality.
 */
export function normalizePersonality(raw: unknown): Personality {
  if (!raw || typeof raw !== 'object') return DEFAULT_PERSONALITY;
  const r = raw as { traits?: Record<string, unknown> };
  const traits = { ...DEFAULT_PERSONALITY.traits };
  for (const k of TRAIT_KEYS) {
    const v = r.traits?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) traits[k] = tidy(v);
  }
  return { preset: matchPreset(traits), traits };
}

/** "sassy", or "custom" once nudged off every preset. */
export function personalityLabel(p: Personality): string {
  return p.preset ? presetById(p.preset).label : 'custom';
}

/** Which third of a slider a value sits in. */
export function band(v: number): 'low' | 'mid' | 'high' {
  return v <= 1 / 3 ? 'low' : v >= 2 / 3 ? 'high' : 'mid';
}
