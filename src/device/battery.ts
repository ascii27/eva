// Battery and charging state as a device-health signal (ASC-45) — pure, no
// React, no native module. What a reading is, how it is said out loud, and
// when it is worth saying unprompted.
//
// No consent gate, unlike the camera: Michael decided (Nov 27) that Eva and
// hermes may read battery and charging state freely. It says nothing about the
// room, only about the phone.
//
// Unknown is its own value throughout, never a zero. The simulator and a build
// without the native module both report nothing, and "0 percent" said aloud
// would be a lie in exactly the situation nobody can check.

/** Mirrors expo-battery's BatteryState, collapsed to what Eva can say. */
export type ChargeState = 'charging' | 'full' | 'unplugged' | 'not_charging' | 'unknown';

export interface BatteryReading {
  /** 0..1, or null when the device will not say (the simulator reports -1). */
  level: number | null;
  state: ChargeState;
  lowPowerMode: boolean;
}

/** expo-battery's numeric enum, mapped without importing the native module. */
export function chargeState(native: number): ChargeState {
  switch (native) {
    case 1:
      return 'unplugged';
    case 2:
      return 'charging';
    case 3:
      return 'full';
    case 4:
      return 'not_charging';
    default:
      return 'unknown';
  }
}

/** A raw level as a reading's level: anything outside 0..1 is unknown. */
export function batteryLevel(native: number): number | null {
  return Number.isFinite(native) && native >= 0 && native <= 1 ? native : null;
}

/** On a cable, whether or not current is flowing into the battery. */
export function isPluggedIn(state: ChargeState): boolean {
  return state === 'charging' || state === 'full' || state === 'not_charging';
}

const percent = (level: number): number => Math.round(level * 100);

/**
 * One sentence about the battery, in the third person of "the phone" so it
 * reads correctly whoever says it — Eva in the room, or hermes in a thread.
 * Written for the ear: "percent", never "%".
 */
export function describeBattery(r: BatteryReading): string {
  const level = r.level === null ? null : percent(r.level);
  let line: string;
  if (r.state === 'full') line = 'The desk phone is fully charged and plugged in.';
  else if (level === null) {
    line =
      r.state === 'unknown'
        ? 'The desk phone cannot read its battery right now.'
        : `The desk phone cannot read its battery level, but it is ${plugPhrase(r.state)}.`;
  } else if (r.state === 'unknown') line = `The desk phone's battery is at ${level} percent.`;
  else line = `The desk phone's battery is at ${level} percent and ${plugPhrase(r.state)}.`;
  return r.lowPowerMode ? `${line} Low power mode is on.` : line;
}

function plugPhrase(state: ChargeState): string {
  switch (state) {
    case 'charging':
      return 'charging';
    case 'full':
      return 'fully charged';
    case 'not_charging':
      return 'plugged in but not charging';
    case 'unplugged':
      return 'not plugged in';
    default:
      return 'of unknown charging state';
  }
}

// ---------------------------------------------------------------------------
// Alerts: when Eva says something about the battery without being asked.

/** Levels at which an unplugged phone is worth mentioning, highest first. */
export const LOW_THRESHOLDS = [0.2, 0.1] as const;

/**
 * How long a cable must stay out before "I've been unplugged" is said. A
 * nudged connector reads as unplugged-then-charging inside a second or two,
 * and announcing every wobble would train everyone to ignore her.
 */
export const UNPLUG_GRACE_MS = 15_000;

export type BatteryAlert = { kind: 'unplugged'; level: number | null } | { kind: 'low'; level: number };

/**
 * What changed between two readings that Eva should say out loud, or null.
 *
 * Transitions only, never states: the first reading after launch (or an OTA
 * reload at 3am) has no `prev` and says nothing, otherwise every reload of an
 * already-unplugged phone would announce it again. A low alert fires once per
 * threshold crossed on the way down, and only off the cable — the level cannot
 * cross downwards twice without a charge in between, so no memory is needed.
 */
export function batteryAlert(prev: BatteryReading | null, next: BatteryReading): BatteryAlert | null {
  if (!prev) return null;
  if (isPluggedIn(prev.state) && next.state === 'unplugged') return { kind: 'unplugged', level: next.level };
  if (isPluggedIn(next.state) || prev.level === null || next.level === null) return null;
  const from = prev.level;
  const to = next.level;
  // One alert however many thresholds were crossed: a jump from 25% to 8%
  // says the urgent thing once, and alertLine picks the wording from `to`.
  return LOW_THRESHOLDS.some((t) => from >= t && to < t) ? { kind: 'low', level: to } : null;
}

/** The line Eva speaks for an alert. First person: this one is always hers. */
export function alertLine(a: BatteryAlert): string {
  if (a.kind === 'unplugged') {
    return a.level === null
      ? "Heads up — I've been unplugged."
      : `Heads up — I've been unplugged, and I'm at ${percent(a.level)} percent.`;
  }
  const level = percent(a.level);
  return a.level < LOW_THRESHOLDS[LOW_THRESHOLDS.length - 1]
    ? `I'm down to ${level} percent battery. I'll go dark soon without a charger.`
    : `My battery's down to ${level} percent, and I'm not plugged in.`;
}

// ---------------------------------------------------------------------------
// hermes' side. hermes has no tools on the device, so it reads the battery two
// ways: passively, as a line beside DESK_PREAMBLE on every hermes-brain turn,
// and on request, by posting `[[battery]]` to the desk in Slack (directives.ts)
// and getting `batteryReport` back.

/**
 * The hermes brain's per-turn system line. Not folded into DESK_PREAMBLE: that
 * one is fixed text, and this changes with the reading. It costs nothing in
 * caching terms — hermes' prefix earns no discount anyway (see useHermes).
 */
export function deskStatusLine(r: BatteryReading): string {
  return `Device status, read just now: ${describeBattery(r)} Mention it only if Michael asks about it or it bears on what he asked.`;
}

/**
 * The desk's answer to a `[[battery]]` request. useSlack's `tell` addresses
 * it to hermes with the raw member-id mention.
 *
 * Posted as a new top-level message rather than into the requesting thread, on
 * purpose: that thread was adopted when hermes mentioned the desk, so anything
 * hermes then said in it would be spoken aloud. Here, hermes' acknowledgement
 * lands in a thread the desk never adopted and stays silent, and saying
 * something out loud is still one `<@desk>` mention away.
 */
export function batteryReport(r: BatteryReading | null): string {
  const body = r ? describeBattery(r) : 'The desk phone could not read its battery.';
  return `Battery reading you asked for: ${body}`;
}
