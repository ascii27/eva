// What the brains are told about the face and the personality (ASC-59) —
// pure strings, no React.
//
// Two pieces, deliberately separate:
//
// - FACE_RULES is fixed text: what `[[face …]]` and `[[pause …]]` are and how to use them. It rides
//   in the local persona and in hermes' DESK_PREAMBLE, both of which must stay
//   byte-identical turn to turn (the local one is the cached prefix).
// - personalityPrompt() changes when the sliders do. On the local brains it is
//   appended to that same leading system message, so a personality change
//   costs exactly one cache miss and then is cached like the rest; on hermes it
//   rides as its own per-turn system line, like the battery reading.
//
// Only sliders that lean say anything. A middle-band slider is silence, so a
// balanced personality adds nothing to the prompt and to the cost.

import { EXPRESSIONS } from '../face/expression';
import { band, personalityLabel, type Personality, type TraitKey } from './traits';

export const FACE_RULES = `Your face shows how you feel, and you choose it. Put a face token in your reply wherever the feeling starts — [[face happy]], [[face amused]], [[face thoughtful]], [[face curious]], [[face surprised]], [[face skeptical]], [[face puzzled]], [[face concerned]] or [[face neutral]] — and add "slightly" or "very" inside the brackets to soften or strengthen it: [[face amused slightly]]. It is never spoken; the face changes when your voice reaches it, and you stay looking that way for a while after you finish. To hold a face long enough to be seen, follow it with a pause — [[pause 1s]], up to four seconds — which stops your voice for that long and then carries on. Normally use one or two faces per reply, and only when there is a real feeling behind it: concerned for bad news, amused at a joke, thoughtful while you weigh something, neutral when it is simply business. When he asks to see your faces, show as many as he asks for, each with a pause after it. Don't smile by default; smile when something is actually good.`;

/** What each lean sounds like, for the two ends of a slider. */
const LEANS: Record<TraitKey, { low: string; high: string }> = {
  humor: {
    low: 'Keep it serious; no jokes.',
    high: 'Be funny — a light joke or a wry aside when the moment allows.',
  },
  warmth: {
    low: 'Be cool and professional rather than affectionate.',
    high: 'Be warm and openly fond of him.',
  },
  sass: {
    low: 'Be gentle and kind, never cutting.',
    high: 'Be sassy: tease him, push back, have opinions and a bit of attitude.',
  },
  energy: {
    low: 'Be calm and unhurried, low-key.',
    high: 'Be upbeat and energetic.',
  },
  chattiness: {
    low: 'Use as few words as will do.',
    high: 'Be chatty: a little colour, a follow-up thought or question, still short enough to listen to.',
  },
  curiosity: {
    low: 'Be matter-of-fact; answer and stop.',
    high: 'Be curious — ask about what he is up to when it fits.',
  },
};

/** Which faces this personality leans toward, said as a hint, never a rule. */
function faceLeanings(p: Personality): string[] {
  const t = p.traits;
  const out: string[] = [];
  if (band(t.humor) === 'high') out.push('amused');
  if (band(t.warmth) === 'high' && band(t.sass) !== 'high') out.push('happy');
  if (band(t.sass) === 'high') out.push('skeptical');
  if (band(t.curiosity) === 'high') out.push('curious');
  if (band(t.humor) === 'low' || band(t.energy) === 'low') out.push('thoughtful');
  return out.filter((e) => (EXPRESSIONS as string[]).includes(e));
}

/**
 * The personality paragraph, or '' when every slider is in the middle. The
 * voice rules elsewhere (one or two sentences, no markdown, a room not a
 * private message) still win; this is manner, not format.
 */
export function personalityPrompt(p: Personality): string {
  const lines: string[] = [];
  for (const k of Object.keys(LEANS) as TraitKey[]) {
    const b = band(p.traits[k]);
    if (b !== 'mid') lines.push(LEANS[k][b]);
  }
  const faces = faceLeanings(p);
  if (!lines.length && !faces.length) return '';
  const head = `Your personality right now (${personalityLabel(p)}). It shapes how you say things, never the rules above about speaking aloud.`;
  const lean = faces.length ? ` Your face leans ${faces.join(', ')}.` : '';
  return `${head} ${lines.join(' ')}${lean}`.trim();
}

/** The local persona with the face rules and the current personality. */
export function personaWith(base: string, p: Personality): string {
  const manner = personalityPrompt(p);
  return manner ? `${base}\n\n${FACE_RULES}\n\n${manner}` : `${base}\n\n${FACE_RULES}`;
}
