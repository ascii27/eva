// Markdown → speakable text — no React, unit-tested.
//
// Eva's written register (bullets, links, mentions, emoji, code) is unlistenable
// as audio. This is client-side insurance for the PRD's response-style problem:
// the real fix is Eva answering conversationally, but whatever formatting still
// arrives gets flattened into plain sentences.
//
// Handles both dialects, because both reach the speaker: Slack mrkdwn from the
// remote hermes-agent (`<@U…>`, `<url|label>`, `*bold*`, `:emoji:`) and ordinary
// markdown from the local agent loop (`[label](url)`, bare URLs).

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_RE = /([*_~`])([^*_~`\n]+)\1/g;
const ANGLE_TOKEN_RE = /<([^<>\n]+)>/g;
// Ordinary markdown links: speak the label, never the url. Runs before the
// angle-token pass so `[label](<url>)` can't lose its label to that rule.
const MD_LINK_RE = /\[([^\]\n]+)\]\([^)\n]*\)/g;
// Bare urls read as noise aloud. Slack wraps its own in <> (handled above), so
// this only ever fires on local-model output.
const BARE_URL_RE = /\bhttps?:\/\/\S+/g;
// Markdown headings are a written-register cue with no spoken equivalent.
const HEADING_RE = /^#{1,6}\s+/;
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

export function speakableFromMrkdwn(raw: string): string {
  let text = raw.replace(CODE_BLOCK_RE, '');
  text = text.replace(MD_LINK_RE, '$1');
  // Unwrap repeatedly: each pass can expose a nested span (`**bold _italic._**`
  // needs three), and a fixed pass count silently leaks delimiters into speech
  // once nesting is one level deeper than the count. Bounded because a
  // guaranteed-terminating loop matters more here than unwrapping the
  // pathological case — this runs on every spoken sentence.
  for (let pass = 0; pass < 6; pass++) {
    const next = text.replace(INLINE_RE, '$2');
    if (next === text) break;
    text = next;
  }
  text = text.replace(ANGLE_TOKEN_RE, (_, body: string) => replaceAngleToken(body));
  text = text.replace(BARE_URL_RE, '');
  text = text.replace(EMOJI_RE, '');

  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const isListOrQuote = BULLET_RE.test(rawLine) || QUOTE_RE.test(rawLine);
    const line = rawLine
      .replace(HEADING_RE, '')
      .replace(BULLET_RE, '')
      .replace(QUOTE_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
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
