// Does a question actually provoke a tool call? `npm run probe:tools [question]`
//
// Sends the real PERSONA and the real tool specs to the real model and reports
// what came back — the same decision the device makes, in about a second,
// without a reload.
//
// It calls chat completions directly rather than through openai.ts, because
// that module's streaming path is built on XMLHttpRequest (React Native cannot
// stream a fetch body) and node has none. Tool *choice* does not depend on
// streaming, so the same messages and the same specs answer the question.
//
// Costs a few hundred tokens per question.

import { readFileSync } from 'node:fs';
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
const model = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? envLocal('EXPO_PUBLIC_OPENAI_MODEL') ?? 'gpt-4o-mini';
if (!apiKey) {
  console.error('No EXPO_PUBLIC_OPENAI_API_KEY in the environment or .env.local.');
  process.exit(1);
}

// Questions Eva cannot answer honestly without reaching for something. Each
// names the tool it ought to provoke.
const DEFAULT_CASES: [string, string][] = [
  ['what time is it', 'clock'],
  ['what day is it today', 'clock'],
  ['who won the last super bowl', 'web_search'],
  ['what is the weather in san francisco right now', 'web_search'],
  ['what is the latest iphone', 'web_search'],
  ['what did we talk about last week', 'memory_search'],
];

const argv = process.argv.slice(2);
const cases: [string, string][] = argv.length ? [[argv.join(' '), '?']] : DEFAULT_CASES;

interface Choice {
  message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] };
}

async function ask(question: string): Promise<Choice['message']> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      // The layout buildRequest produces: persona as one leading system
      // message, then the turn. No remembered summaries — a fresh session.
      messages: [
        { role: 'system', content: PERSONA },
        { role: 'user', content: question },
      ],
      tools: toolSpecs('probe-key').map((t) => ({ type: 'function', function: t })),
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`http ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Choice[] };
  return data.choices?.[0]?.message;
}

console.log(`\nmodel: ${model}`);
console.log(`tools offered: ${toolSpecs('probe-key').map((t) => t.name).join(', ')}\n`);

let called = 0;
for (const [question, expected] of cases) {
  const message = await ask(question);
  const tools = (message?.tool_calls ?? []).map((c) => c.function?.name).filter(Boolean);
  const preamble = (message?.content ?? '').trim();

  const hit = tools.length > 0;
  if (hit) called++;
  console.log(`${hit ? 'CALLED  ' : 'DECLINED'}  "${question}"  (want: ${expected})`);
  if (hit) {
    console.log(`          tools: ${tools.join(', ')}`);
    // Empty here means the preamble rule was ignored — the sentence Eva is
    // supposed to speak while the tool runs. Silence in the gap comes from this.
    console.log(`          preamble: ${preamble ? `"${preamble}"` : '(NONE — she will be silent during the gap)'}`);
  } else {
    console.log(`          said: "${preamble.slice(0, 160)}"`);
  }
}

console.log(`\n${called}/${cases.length} provoked a tool call.\n`);
