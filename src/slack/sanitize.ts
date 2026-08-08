// Slack mrkdwn → speakable text — no React, unit-tested.
//
// Eva's Slack register (bullets, links, mentions, emoji) is unlistenable as
// audio. This is client-side insurance for the PRD's response-style problem:
// the real fix is Eva answering conversationally in the voice channel, but
// whatever formatting still arrives gets flattened into plain sentences.

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_RE = /([*_~`])([^*_~`\n]+)\1/g;
const ANGLE_TOKEN_RE = /<([^<>\n]+)>/g;
// Requires one non-digit so clock times ("23:52:26") survive; loses only
// the rare all-numeric codes like :100:.
const EMOJI_RE = /:[0-9]*[a-z_+\-][a-z0-9_+\-]*:/g;
const BULLET_RE = /^(?:[•\-*]|\d+[.)])\s+/;
const QUOTE_RE = /^>\s?/;
const ENDS_PUNCTUATED_RE = /[.!?…:;,]$/;

function replaceAngleToken(body: string): string {
  if (body.startsWith('!')) return ''; // <!here>, <!channel>, <!subteam…>
  if (body.startsWith('@')) return ''; // user mentions read oddly aloud
  const label = body.includes('|') ? body.slice(body.indexOf('|') + 1) : null;
  if (body.startsWith('#')) return label ? `#${label}` : '';
  return label ?? ''; // links: speak the label, never the url
}

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

// First word after the tool-echo emoji prefix, e.g. ":computer: terminal …"
// → "terminal", ":books: skill_view: …" → "skill_view".
const TOOL_LABEL_RE = /^\s*:[a-z0-9_+\-]+:\s*([A-Za-z0-9_\-]+)/;

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

export function speakableFromMrkdwn(raw: string): string {
  let text = raw.replace(CODE_BLOCK_RE, '');
  // Unwrap twice so nested emphasis (`*_x_*`) fully unwraps.
  text = text.replace(INLINE_RE, '$2').replace(INLINE_RE, '$2');
  text = text.replace(ANGLE_TOKEN_RE, (_, body: string) => replaceAngleToken(body));
  text = text.replace(EMOJI_RE, '');

  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const isListOrQuote = BULLET_RE.test(rawLine) || QUOTE_RE.test(rawLine);
    const line = rawLine.replace(BULLET_RE, '').replace(QUOTE_RE, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    // List items and quotes become sentences; plain lines just flow together.
    lines.push(isListOrQuote && !ENDS_PUNCTUATED_RE.test(line) ? `${line}.` : line);
  }

  return lines
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
