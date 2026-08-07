// Slack mrkdwn → speakable text — no React, unit-tested.
//
// Eva's Slack register (bullets, links, mentions, emoji) is unlistenable as
// audio. This is client-side insurance for the PRD's response-style problem:
// the real fix is Eva answering conversationally in the voice channel, but
// whatever formatting still arrives gets flattened into plain sentences.

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_RE = /([*_~`])([^*_~`\n]+)\1/g;
const ANGLE_TOKEN_RE = /<([^<>\n]+)>/g;
const EMOJI_RE = /:[a-z0-9_+\-]+:/g;
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
