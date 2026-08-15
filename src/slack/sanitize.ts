// Slack tool-echo detection — no React, unit-tested.
//
// The mrkdwn → speech flattener moved to src/round/speakable.ts once the local
// agent loop needed it too; what stays here is genuinely Slack-shaped, keyed to
// hermes-agent's system register in the channel.

import { speakableFromMrkdwn } from '../round/speakable';

// First word after the tool-echo emoji prefix, e.g. ":computer: terminal …"
// → "terminal", ":books: skill_view: …" → "skill_view".
const TOOL_LABEL_RE = /^\s*:[a-z0-9_+\-]+:\s*([A-Za-z0-9_\-]+)/;

/**
 * True for messages that are tool noise rather than an answer. Eva's system
 * register consistently opens with an emoji-code label (":computer: terminal",
 * ":books: skill_view: …", ":warning: Gateway restarting…") while her
 * conversational answers open with plain prose — that prefix is the signature.
 * A pending ask should skip these and wait for the substantive message.
 */
export function isToolEcho(raw: string): boolean {
  if (/^\s*:[a-z0-9_+\-]+:/.test(raw)) return true;
  const speakable = speakableFromMrkdwn(raw);
  if (!speakable) return true;
  return speakable.length < 12 && raw.includes('```');
}

/**
 * The tool label of a tool-echo message (lowercased), or null when the text
 * doesn't open with an emoji-code prefix. Callers narrating tool activity
 * map this through their own phrase table — the label itself is an internal
 * name (skill_view, terminal) and never spoken verbatim.
 */
export function toolLabelFromEcho(raw: string): string | null {
  const m = TOOL_LABEL_RE.exec(raw);
  return m ? m[1].toLowerCase() : null;
}
