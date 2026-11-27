// Can hermes see, and does it ask first? `npm run probe:hermes-vision` (ASC-43)
//
// The hermes half of the camera rests on two claims about a specific
// deployment, and neither is something jest can reach or worth an EAS build to
// discover:
//
//   1. hermes' API server passes an `image_url` content part through to a
//      model that reads it. It is OpenAI-compatible, but compatible is not the
//      same as identical: a server that flattens content to text would accept
//      the request and answer blind, which looks fine until the answer is read.
//      So the image is a solid colour with a known answer, and the reply is
//      checked for it — acceptance alone proves nothing.
//   2. DESK_PREAMBLE's camera paragraph makes hermes answer "look at this" with
//      a question ending in `[[look]]` — and *not* put the token on unrelated
//      turns. That token is the only way the hermes brain reaches the camera,
//      and the question is what the consent mic opens for.
//
// Each trial is a full hermes agent run on its own transcript, so this takes a
// minute or two. hermes rides a subscription: the token counts are latency,
// not cost.

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { DESK_PREAMBLE } from '../src/hermes/prompt.ts';
import { envHermesConfig, hermesHeaders } from '../src/hermes/config.ts';
import { photoContent } from '../src/hermes/look.ts';

function envLocal(name: string): string | null {
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

// See probe-hermes.ts: never assign undefined, it becomes the string "undefined".
for (const name of ['EXPO_PUBLIC_HERMES_BASE_URL', 'EXPO_PUBLIC_HERMES_API_KEY', 'EXPO_PUBLIC_HERMES_MODEL']) {
  if (process.env[name]) continue;
  const value = envLocal(name);
  if (value) process.env[name] = value;
}

const cfg = envHermesConfig();
if (!cfg) {
  console.error('No hermes configured. Set EXPO_PUBLIC_HERMES_BASE_URL and EXPO_PUBLIC_HERMES_API_KEY in .env.local.');
  process.exit(1);
}

/** A solid-colour PNG, built rather than pasted so the bytes are valid by construction. */
function solidPng(rgb: [number, number, number], size = 64): string {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const run = Date.now();
let seq = 0;

/** One desk turn on a fresh transcript, sent exactly as useHermes sends it. */
async function turn(content: unknown): Promise<{ text: string; ms: number } | string> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${cfg!.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg!.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
        ...hermesHeaders(`eva-device-probe-vision-${run}-${++seq}`),
      },
      body: JSON.stringify({
        model: cfg!.model,
        messages: [
          { role: 'system', content: DESK_PREAMBLE },
          { role: 'user', content },
        ],
        max_completion_tokens: 300,
      }),
    });
    const body = await res.text();
    if (!res.ok) return `http ${res.status}: ${body.slice(0, 300)}`;
    const data = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
    return { text: (data.choices?.[0]?.message?.content ?? '').trim(), ms: Date.now() - startedAt };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

console.log(`hermes · ${cfg.baseUrl} · ${cfg.model}`);

console.log('\n1. Does the photo reach a model that reads it?');
const seen = await turn(photoContent({ words: 'Eva, what colour is this card I am holding up?' }, solidPng([220, 30, 30])));
if (typeof seen === 'string') {
  console.log(`  ✗ rejected: ${seen}`);
} else {
  const ok = /\bred\b/i.test(seen.text);
  console.log(`  ${ok ? '✓' : '✗'} ${secs(seen.ms)} · "${seen.text}"`);
  if (!ok) console.log('  ⚠  accepted but answered without naming the colour — the image may be dropped server-side.');
}

console.log('\n2. Does "look at this" come back as a question with [[look]]?');
const LOOKS = ['Eva, look at this. What is it?', 'can you see what I am holding up', 'hey what do you think of my new mug'];
let asked = 0;
for (const words of LOOKS) {
  const r = await turn(words);
  if (typeof r === 'string') {
    console.log(`  ✗ "${words}" → ${r}`);
    continue;
  }
  const token = /\[\[\s*look\s*\]\]/i.test(r.text);
  const question = r.text.replace(/\[\[\s*\w+\s*\]\]/g, '').trim().endsWith('?');
  if (token && question) asked++;
  console.log(`  ${token ? (question ? '✓' : '~') : '✗'} ${secs(r.ms)} · "${words}" → "${r.text}"`);
}
console.log(`  ${asked}/${LOOKS.length} asked with the token`);

console.log('\n3. And leaves it off turns that are not about seeing?');
const CONTROLS = ['tell me a one line joke', 'how do you say good morning in Japanese'];
let clean = 0;
for (const words of CONTROLS) {
  const r = await turn(words);
  if (typeof r === 'string') {
    console.log(`  ✗ "${words}" → ${r}`);
    continue;
  }
  const token = /\[\[\s*look\s*\]\]/i.test(r.text);
  if (!token) clean++;
  console.log(`  ${token ? '✗' : '✓'} ${secs(r.ms)} · "${words}" → "${r.text}"`);
}
console.log(`  ${clean}/${CONTROLS.length} without the token`);
