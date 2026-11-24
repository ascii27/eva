// Desk directives — no React, unit-tested.
//
// hermes has no tools on the device: when it answers a turn (the hermes and
// Slack brains) or speaks first (a proactive Slack message), the only thing it
// can hand down is text. So the face's few commands ride inside that text as
// tokens — `[[sleep]]`, `[[wake]]` — which speakableFromMrkdwn strips before
// anything reaches the speaker. The local brains use real tools instead
// (go_to_sleep / wake_up); this is the same capability for the half that can't.
//
// Double brackets because nothing Eva writes for the ear uses them, and Slack
// mrkdwn leaves them alone.

export type DeskDirective = 'sleep' | 'wake';

export const DIRECTIVE_RE = /\[\[\s*(sleep|wake)\s*\]\]/gi;

/**
 * The directive a message carries, or null. When one message somehow carries
 * both, the last one wins — "wake up… actually go back to sleep" ends asleep.
 */
export function readDirective(raw: string): DeskDirective | null {
  let last: DeskDirective | null = null;
  for (const m of raw.matchAll(DIRECTIVE_RE)) last = m[1].toLowerCase() as DeskDirective;
  return last;
}
