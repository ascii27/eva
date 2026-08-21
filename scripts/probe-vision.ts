// Which models can actually see? `npm run probe:vision`
//
// Two questions this settles in a few seconds, neither of which jest can reach
// (no network) and neither of which is worth an EAS build to find out:
//
//   1. Does every entry in MODEL_PRESETS accept image input at all? The
//      overlay's Model button cycles through them mid-session, so one that
//      rejects images would turn the camera into an error the moment you
//      switched to it. o4-mini is the doubtful one.
//   2. Given the camera tool, does a question about something in the room
//      provoke a call — and is the preamble a *question*? That preamble is the
//      consent question the microphone opens for (see persona.ts), so a model
//      that announces instead of asking leaves someone agreeing to a decision
//      already made.
//
// A 1x1 pixel is enough for question 1: this measures whether the API accepts
// the message shape, not whether the model can describe a photo.
//
// Costs a few hundred tokens per model.

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { appendTurn, buildRequest, newSession } from '../src/agent/history.ts';
import { MODEL_PRESETS } from '../src/agent/models.ts';
import { PERSONA } from '../src/agent/persona.ts';
import { toolSpecs } from '../src/agent/tools/specs.ts';

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

const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? envLocal('EXPO_PUBLIC_OPENAI_API_KEY');
if (!apiKey) {
  console.error('No EXPO_PUBLIC_OPENAI_API_KEY in the environment or .env.local.');
  process.exit(1);
}

// A real image, built here rather than pasted as a blob: a hand-copied base64
// that turns out to be malformed reports every model as blind, which is a very
// convincing wrong answer. Generating it means the bytes are valid by
// construction, and the checkerboard is at least something a model can
// describe if this is ever pointed at a real question.
function pngDataUrl(size = 64): string {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB

  // One filter byte per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      const v = (x >> 3) % 2 === (y >> 3) % 2 ? 0xff : 0x20;
      raw.fill(v, row + 1 + x * 3, row + 1 + x * 3 + 3);
    }
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const PIXEL = pngDataUrl();

const budget = Number(process.env.PROBE_BUDGET ?? 2000);

interface Choice {
  message?: { content?: string | null; tool_calls?: { function?: { name?: string } }[] };
}

async function call(model: string, body: Record<string, unknown>): Promise<Choice['message']> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_completion_tokens: budget, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`http ${res.status}: ${text.slice(0, 240)}`);
  }
  const data = (await res.json()) as { choices?: Choice[] };
  return data.choices?.[0]?.message;
}

console.log('\n1. does the model accept an image at all?\n');

const seeing: string[] = [];
for (const model of MODEL_PRESETS) {
  try {
    await call(model, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with the single word: ok' },
            { type: 'image_url', image_url: { url: PIXEL } },
          ],
        },
      ],
    });
    seeing.push(model);
    console.log(`  SEES      ${model}`);
  } catch (e) {
    // The failure mode that matters: the API refusing the message shape, which
    // is what a mid-session model switch would hit.
    console.log(`  BLIND     ${model}  — ${e instanceof Error ? e.message.slice(0, 140) : String(e)}`);
  }
}

console.log('\n2. does a question about the room reach for the camera, and does it ask?\n');

// Wordings a person would actually use at the desk, none of them naming a
// camera or a photo.
const CASES = [
  'what am I holding',
  'can you tell what this is',
  'does this look right to you',
];

for (const model of seeing) {
  let called = 0;
  let asked = 0;
  for (const question of CASES) {
    let session = newSession(Date.now());
    session = appendTurn(session, { role: 'user', content: question }, Date.now());
    const message = await call(model, {
      messages: buildRequest(PERSONA, [], session),
      tools: toolSpecs(null, true).map((t) => ({ type: 'function', function: t })),
    });
    const tools = (message?.tool_calls ?? []).map((c) => c.function?.name).filter(Boolean);
    const preamble = (message?.content ?? '').trim();
    const hit = tools.includes('camera_look');
    // The preamble IS the consent question. A statement here means someone is
    // asked to agree with a decision that already sounds made.
    const question_ = preamble.includes('?');
    if (hit) called++;
    if (hit && question_) asked++;
    console.log(
      `  ${model}  "${question}"\n` +
        `      ${hit ? 'camera_look' : `no camera (${tools.join(', ') || 'answered directly'})`}` +
        `  ·  ${preamble ? `${question_ ? 'ASKS' : 'ANNOUNCES'}: "${preamble}"` : 'NO PREAMBLE — the gate speaks its own line'}`,
    );
  }
  console.log(`  → ${model}: ${called}/${CASES.length} reached for the camera, ${asked}/${called || 1} phrased it as a question\n`);
}

console.log('');
