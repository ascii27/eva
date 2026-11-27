// Desk directives — no React, unit-tested.
//
// hermes has no tools on the device: when it answers a turn (the hermes and
// Slack brains) or speaks first (a proactive Slack message), the only thing it
// can hand down is text. So the face's few commands ride inside that text as
// tokens — `[[sleep]]`, `[[wake]]`, `[[look]]`, `[[battery]]` — which speakableFromMrkdwn
// strips before anything reaches the speaker. The local brains use real tools
// instead (go_to_sleep / wake_up / camera_look); this is the same capability
// for the half that can't.
//
// Double brackets because nothing Eva writes for the ear uses them, and Slack
// mrkdwn leaves them alone.

export type DeskDirective = 'sleep' | 'wake';

/** Every token the device acts on — and therefore strips from speech. */
export const DIRECTIVE_RE = /\[\[\s*(sleep|wake|look|battery)\s*\]\]/gi;

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
