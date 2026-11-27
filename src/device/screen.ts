// Screen brightness as something Eva and hermes can set (ASC-46) — pure, no
// React, no native module. brightness.ts does the I/O; useSleep owns the clock.
//
// No consent gate (Michael's decision, Nov 27): Eva owns this phone's screen.
// But setting it is a control action, so every change is reported back as
// before → after, and says how long it will hold.
//
// What wins, a person or the schedule? A level someone asked for holds until
// the schedule's next edge — 22:00, when the night dims her, or 06:00, when
// the morning puts the daytime level back — and through every night phase in
// between except asleep. Asleep stays dark whatever was asked: eyes shut with
// the screen at full is neither asleep nor awake. So "dim the screen" at 23:00
// stays dim (the night's own 10% must not brighten it again a minute later),
// and "turn the screen up" at 23:00 holds until she next dozes off.
//
// A level set by day therefore simply *is* the daytime level: nothing else
// touches brightness by day, and at 22:00 brightness.ts saves whatever the
// phone is at as the level to restore in the morning.

import { SLEEPY_END_HOUR, SLEEPY_START_HOUR } from '../face/constants';
import { nightBrightness, type SleepPhase } from '../face/sleep';
import { describeLight, type LightReading } from './light';

/** A level asked for by someone, held until `until` (ms). */
export interface ManualBrightness {
  level: number;
  until: number;
}

/** The lowest level a request may set. iOS at 0 is a black screen, not a dim one. */
export const MIN_LEVEL = 0.01;

export const clampLevel = (level: number): number => Math.min(1, Math.max(MIN_LEVEL, level));

/** A percent from a tool or a token (0-100) as a level, or null if unusable. */
export function levelFromPercent(percent: unknown): number | null {
  const n = typeof percent === 'string' ? Number(percent.replace('%', '').trim()) : percent;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return clampLevel(n / 100);
}

export type Adjust = 'brighter' | 'dimmer';

/**
 * One step brighter or dimmer. Multiplicative, because brightness is perceived
 * roughly logarithmically: 40% → 20% is the same "dimmer" as 10% → 5%, where a
 * fixed 25-point step would skip straight to black from anywhere low.
 */
export function adjustLevel(current: number, dir: Adjust): number {
  if (dir === 'dimmer') return clampLevel(current / 2);
  return clampLevel(Math.max(current * 2, current + 0.2));
}

/** The next 06:00 or 22:00 after `now`, in ms — where a manual level lapses. */
export function nextScheduleEdge(now: Date): number {
  const candidates: number[] = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of [SLEEPY_END_HOUR, SLEEPY_START_HOUR]) {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() > now.getTime()) candidates.push(d.getTime());
    }
  }
  return Math.min(...candidates);
}

export function manualActive(m: ManualBrightness | null, now: number): m is ManualBrightness {
  return m !== null && now < m.until;
}

/**
 * The level to set for a phase, or null to leave the screen alone (by day,
 * with nobody's request in force). `day` is the saved daytime level.
 */
export function targetLevel(phase: SleepPhase, night: boolean, day: number, manual: ManualBrightness | null, now: number): number | null {
  if (manualActive(manual, now)) {
    return phase === 'asleep' ? Math.min(manual.level, nightBrightness('asleep', day)) : manual.level;
  }
  if (phase === 'awake' && !night) return null;
  return nightBrightness(phase, day);
}

export const percent = (level: number): number => Math.round(level * 100);

/** "ten at night" / "six in the morning" — the only two edges there are. */
export function edgePhrase(until: number): string {
  const h = new Date(until).getHours();
  if (h === SLEEPY_START_HOUR) return 'ten at night, when the night schedule takes over';
  if (h === SLEEPY_END_HOUR) return 'six in the morning, when the daytime level comes back';
  return 'the schedule next changes';
}

export function describeScreen(level: number | null): string {
  return level === null ? 'The desk phone cannot read its screen brightness.' : `The desk phone's screen is at ${percent(level)} percent brightness.`;
}

export interface BrightnessChange {
  before: number | null;
  after: number | null;
  until: number;
}

/** What changed, for the tool result, the transcript and hermes. */
export function describeChange(c: BrightnessChange): string {
  if (c.after === null) return 'The screen brightness could not be set.';
  const from = c.before === null ? '' : `was ${percent(c.before)} percent and `;
  return `The desk phone's screen ${from}is now at ${percent(c.after)} percent brightness. It stays there until ${edgePhrase(c.until)}, or until the face falls asleep.`;
}

/** Transcript shorthand: `40% → 20%`. */
export function changeLog(c: BrightnessChange): string {
  const p = (l: number | null) => (l === null ? '?' : `${percent(l)}%`);
  return `${p(c.before)} → ${p(c.after)}`;
}

// ---------------------------------------------------------------------------
// hermes' side, mirroring battery.ts: a per-turn system line on the hermes
// brain, and replies to `[[light]]` / `[[brightness]]` sent over Slack by
// useSlack.tell (new top-level messages, so nothing hermes says back is
// spoken).

/**
 * The hermes brain's per-turn line: the screen now, and the last light
 * reading if there is one. Never a fresh light reading — that would turn the
 * camera on for every turn.
 */
export function screenStatusLine(level: number | null, light: LightReading | null, now: number): string | null {
  if (level === null && light === null) return null;
  const parts = [level === null ? null : describeScreen(level), light ? describeLight(light, now) : null].filter(Boolean);
  return `Desk status: ${parts.join(' ')} To change the screen brightness, end your reply with [[brightness N]], N a percent. Mention any of this only if Michael asks or it bears on what he asked.`;
}

/** The desk's answer to `[[light]]`. */
export function lightReport(r: { reading: LightReading } | { error: string }, level: number | null, now: number): string {
  const body = 'error' in r ? `The desk could not measure the light: ${r.error}` : describeLight(r.reading, now);
  return `Light reading you asked for: ${body} ${describeScreen(level)}`;
}

/** The desk's answer to `[[brightness]]` (a read) or `[[brightness N]]` (a change). */
export function brightnessReport(r: { kind: 'read'; level: number | null } | { kind: 'set'; change: BrightnessChange } | { kind: 'invalid' }): string {
  if (r.kind === 'invalid') return 'Brightness request not understood: use [[brightness N]] with N a percent from 1 to 100, or [[brightness]] to read it.';
  if (r.kind === 'read') return `Brightness reading you asked for: ${describeScreen(r.level)}`;
  return `Brightness changed as you asked: ${describeChange(r.change)}`;
}
