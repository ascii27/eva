// Desk directives — no React, unit-tested.
//
// hermes has no tools on the device: when it answers a turn (the hermes and
// Slack brains) or speaks first (a proactive Slack message), the only thing it
// can hand down is text. So the face's few commands ride inside that text as
// tokens — `[[sleep]]`, `[[wake]]`, `[[look]]`, `[[battery]]`, `[[light]]`, `[[brightness N]]`, `[[location]]`,
// `[[face amused]]`, `[[pause 1s]]` (ASC-59; every brain, see round/cues.ts) — which speakableFromMrkdwn
// strips before anything reaches the speaker. The local brains use real tools
// instead (go_to_sleep / wake_up / camera_look); this is the same capability
// for the half that can't.
//
// Double brackets because nothing Eva writes for the ear uses them, and Slack
// mrkdwn leaves them alone.

export type DeskDirective = 'sleep' | 'wake';

/** Every token the device acts on — and therefore strips from speech. */
export const DIRECTIVE_RE = /\[\[\s*(sleep|wake|look|battery|light|location|brightness(?:\s*[:=]?\s*[^\]]*)?|face\b[^\]]*|pause\b[^\]]*)\s*\]\]/gi;

/**
 * The sleep/wake directive a message carries, or null. When one message
 * somehow carries both, the last one wins — "wake up… actually go back to
 * sleep" ends asleep. `[[look]]` is not a sleep state and never comes back
 * from here; see `wantsLook`.
 */
export function readDirective(raw: string): DeskDirective | null {
  let last: DeskDirective | null = null;
  for (const m of raw.matchAll(DIRECTIVE_RE)) {
    const d = m[1].toLowerCase();
    if (d === 'sleep' || d === 'wake') last = d;
  }
  return last;
}

/**
 * Whether hermes is asking to see through the camera (ASC-43).
 *
 * This is a *request*, never a shutter: the message carrying it is the spoken
 * consent question, and the device opens the lens only after an audible yes.
 * The token is read separately from sleep/wake because it composes with them
 * rather than competing — "mind if I take a look before I turn in?" may
 * legitimately carry both.
 */
export function wantsLook(raw: string): boolean {
  for (const m of raw.matchAll(DIRECTIVE_RE)) if (m[1].toLowerCase() === 'look') return true;
  return false;
}

/**
 * Whether hermes is asking for the desk phone's battery reading (ASC-45).
 *
 * The device_battery tool, for the half that has no tools. Unlike `[[look]]`
 * there is no gate (Michael's decision) and nothing to say: the desk answers by
 * posting the reading to hermes in Slack (battery.ts's batteryReport), and the
 * face is not woken for it.
 */
export function asksForBattery(raw: string): boolean {
  for (const m of raw.matchAll(DIRECTIVE_RE)) if (m[1].toLowerCase() === 'battery') return true;
  return false;
}

// ---------------------------------------------------------------------------
// The screen and the room (ASC-46). `[[light]]` asks for a light-meter
// reading, answered in Slack exactly like `[[battery]]`. `[[brightness]]` asks
// for the screen's level; `[[brightness 30]]` sets it to 30 percent — a
// command, so it is also honoured inside a hermes-brain reply, and the desk
// reports the change back either way.

/** True when a message asks the desk for a light reading. */
export function asksForLight(raw: string): boolean {
  for (const m of raw.matchAll(DIRECTIVE_RE)) if (m[1].toLowerCase() === 'light') return true;
  return false;
}

export type BrightnessToken = { kind: 'read' } | { kind: 'set'; percent: number } | { kind: 'invalid' };

const BRIGHTNESS_RE = /\[\[\s*brightness\s*(?:[:=]?\s*([^\]]*?))?\s*\]\]/gi;

/**
 * The brightness token a message carries, or null. A level that isn't a
 * percent from 0 to 100 is `invalid` rather than ignored, so hermes hears that
 * it got the token wrong instead of silence. The last one wins, as with sleep.
 */
export function readBrightness(raw: string): BrightnessToken | null {
  let last: BrightnessToken | null = null;
  for (const m of raw.matchAll(BRIGHTNESS_RE)) {
    const arg = (m[1] ?? '').trim();
    if (!arg) {
      last = { kind: 'read' };
      continue;
    }
    const n = Number(arg.replace(/%$/, '').trim());
    last = Number.isFinite(n) && n >= 0 && n <= 100 ? { kind: 'set', percent: n } : { kind: 'invalid' };
  }
  return last;
}

/**
 * Whether hermes is asking which town the desk is in (ASC-44). Answered in
 * Slack exactly like `[[battery]]`: no gate (Michael's decision), nothing
 * spoken, and the face is not woken for it. Only the town is ever sent.
 */
export function asksForLocation(raw: string): boolean {
  for (const m of raw.matchAll(DIRECTIVE_RE)) if (m[1].toLowerCase() === 'location') return true;
  return false;
}
