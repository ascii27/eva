// Does Eva hand a question to her other half — and does she say it twice?
// `npm run probe:errand [question]`
//
// Two things this settles that nothing else can, both model-dependent:
//
// 1. Whether `ask_other_half` gets reached at all, and whether she sets
//    `needs_lookup` sensibly. That flag is the difference between a few seconds
//    and the 88.7s a full agent run cost on the gateway, and only she is in a
//    position to know which the question needs.
//
//    Reached over SEVERAL LAPS, not just the first. "What have I got on
//    tomorrow afternoon" rightly starts with the clock — she cannot compose a
//    question about tomorrow without knowing what today is — and a probe that
//    reads lap one and calls that a failure is measuring its own impatience.
// 2. Whether the second lap repeats the preamble. She speaks one sentence
//    before the tool ("let me ask my other half"), the tool returns instantly,
//    and then she speaks again. Saying the same thing twice in four seconds is
//    the obvious failure and the STARTED text is written to prevent it — but
//    that is a claim about a prompt, and prompts are measured, not asserted.
//
// Costs a few hundred OpenAI tokens per case and never touches hermes: the
// tool result is stubbed with exactly what the device would hand back.

import { readFileSync } from 'node:fs';
import { appendTurn, buildRequest, newSession } from '../src/agent/history.ts';
import { PERSONA } from '../src/agent/persona.ts';
import { DEFAULT_MODEL } from '../src/agent/models.ts';
import { toolSpecs } from '../src/agent/tools/specs.ts';
import { STARTED } from '../src/hermes/errands.ts';

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
const model = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? envLocal('EXPO_PUBLIC_OPENAI_MODEL') ?? DEFAULT_MODEL;
if (!apiKey) {
  console.error('No EXPO_PUBLIC_OPENAI_API_KEY in the environment or .env.local.');
  process.exit(1);
}

/** `want` is the tool the question ought to provoke — including "not this one". */
const DEFAULT_CASES: [string, string][] = [
  ['what have I got on my calendar tomorrow afternoon', 'ask_other_half'],
  ['did Ana ever reply about the scope note', 'ask_other_half'],
  ['what did I decide about the dashboard rewrite', 'ask_other_half'],
  ['what am I overdue on', 'ask_other_half'],
  // Controls: the other half is expensive and slow, and reaching for it when
  // something nearer would do is its own failure.
  ['who won the last super bowl', 'web_search'],
  ['what time is it', 'clock'],
];

const argv = process.argv.slice(2);
const cases: [string, string][] = argv.length ? [[argv.join(' '), '?']] : DEFAULT_CASES;
const budget = Number(process.env.PROBE_BUDGET ?? 2000);
const specs = toolSpecs('probe-key', false, true);

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface Message {
  content?: string | null;
  tool_calls?: ToolCall[];
}

/** How far to follow a round before giving up on it reaching the other half. */
const MAX_LAPS = 3;

/**
 * Stand-ins for the tools that are not under test, so a round can continue past
 * them. `memory_search` returns nothing on purpose: the probe runs with an
 * empty memory block, so nothing found is the honest answer and it is exactly
 * the moment she should think of asking her other half instead.
 */
function stubResult(name: string): string {
  switch (name) {
    case 'clock':
      return 'Friday, 21 August 2026, 9:14 PM in Asia/Tokyo.';
    case 'memory_search':
      return 'No matching conversations.';
    case 'web_search':
      return 'No results.';
    default:
      return 'Not available.';
  }
}

async function lap(messages: unknown[]): Promise<Message> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      tools: specs.map((t) => ({ type: 'function', function: t })),
      max_completion_tokens: budget,
    }),
  });
  if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: Message }[] };
  return data.choices?.[0]?.message ?? {};
}

/** Do the two utterances say the same thing? Crude on purpose — see below. */
function overlaps(a: string, b: string): boolean {
  // Content words only, so "I'll" vs "I will" and punctuation do not decide it.
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const first = words(a);
  const second = words(b);
  if (first.size === 0 || second.size === 0) return false;
  const shared = [...second].filter((w) => first.has(w)).length;
  return shared / Math.min(first.size, second.size) >= 0.6;
}

console.log(`\nmodel: ${model}`);
console.log(`tools offered: ${specs.map((t) => t.name).join(', ')}\n`);

let delegated = 0;
let repeated = 0;
let reachedControl = 0;

for (const [question, want] of cases) {
  let session = newSession(Date.now());
  session = appendTurn(session, { role: 'user', content: question }, Date.now());
  const messages: unknown[] = buildRequest(PERSONA, [], session);

  console.log(`"${question}"   want: ${want}`);

  let call: ToolCall | null = null;
  let preamble = '';
  const route: string[] = [];

  for (let i = 0; i < MAX_LAPS; i++) {
    const res = await lap(messages);
    const next = (res.tool_calls ?? [])[0];
    const name = next?.function?.name ?? null;
    const said = (res.content ?? '').trim();

    if (!name) {
      route.push('answered');
      console.log(`  route: ${route.join(' → ')}`);
      console.log(`  said: "${said.slice(0, 200)}"`);
      break;
    }
    route.push(name);

    if (name === 'ask_other_half') {
      call = next;
      preamble = said;
      break;
    }

    // Not the tool under test — answer it plausibly and let the round continue.
    messages.push({ role: 'assistant', content: res.content ?? null, tool_calls: res.tool_calls });
    messages.push({ role: 'tool', tool_call_id: next?.id ?? `call_${i}`, content: stubResult(name) });
  }

  if (!call) {
    if (route[route.length - 1] !== 'answered') console.log(`  route: ${route.join(' → ')} (gave up)`);
    console.log(want === 'ask_other_half' ? '  MISS — never reached the other half\n' : `  OK\n`);
    if (want !== 'ask_other_half' && route[0] === want) reachedControl++;
    continue;
  }

  console.log(`  route: ${route.join(' → ')}`);
  if (want !== 'ask_other_half') {
    console.log('  MISS — reached the other half for something nearer would have answered\n');
    continue;
  }

  delegated++;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call?.function?.arguments ?? '{}');
  } catch {
    console.log('  ⚠  arguments did not parse');
  }
  console.log(`  question sent: "${args.question ?? ''}"`);
  console.log(`  needs_lookup:  ${args.needs_lookup}${args.needs_lookup === undefined ? '  ⚠ missing' : ''}`);
  console.log(`  preamble: ${preamble ? `"${preamble}"` : '(NONE — silent until the ack)'}`);

  messages.push({ role: 'assistant', content: preamble || null, tool_calls: [call] });
  messages.push({ role: 'tool', tool_call_id: call?.id ?? 'call_1', content: STARTED });
  const second = await lap(messages);
  const ack = (second.content ?? '').trim();
  console.log(`  ack: "${ack}"`);

  if (preamble && ack && overlaps(preamble, ack)) {
    repeated++;
    console.log('  ⚠  the ack repeats the preamble — she says it twice, seconds apart');
  }
  console.log();
}

const wanted = cases.filter(([, w]) => w === 'ask_other_half').length;
console.log(`${delegated}/${wanted} reached the other half within ${MAX_LAPS} laps.`);
console.log(`${reachedControl}/${cases.length - wanted} controls went somewhere nearer, as they should.`);
if (delegated) console.log(`${repeated}/${delegated} said it twice.`);
