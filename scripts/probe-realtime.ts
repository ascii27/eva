// Does the Realtime API, in text mode, behave the way the device needs?
// `npm run probe:realtime [question ...]`
//
// Phase 1 puts Eva's local brain on a Realtime WebSocket session: text in,
// text out, on-device STT and Kokoro TTS unchanged. Five things that design
// rests on cannot be settled by reading — this settles them in about a second
// each, against the real API, without a reload:
//
//   1. Auth. Node's global WebSocket takes no headers, so this uses the
//      documented subprotocol form. If a standard sk- key is refused here,
//      the probe needs the `ws` package (the device does not — React Native's
//      WebSocket accepts a headers option).
//   2. Event names. The GA interface renamed the one that matters most:
//      `response.text.delta` became `response.output_text.delta`. The beta
//      spelling does not error, it simply never fires, so every distinct
//      server event seen is printed rather than assumed.
//   3. The preamble rate — the sentence Eva says while a tool runs, and the
//      question the consent microphone opens for. Measured for the chat
//      models in models.ts; unmeasured for every realtime model.
//   4. Whether `response.create` honours a per-response `tool_choice: 'none'`,
//      which is how the forced-answer last lap survives without rewriting
//      session config mid-flight.
//   5. Whether a text-only session needs turn detection explicitly nulled to
//      stop the default voice-activity config creating responses on its own.
//
// Costs a few hundred tokens per question.

import { readFileSync } from 'node:fs';
import { PERSONA } from '../src/agent/persona.ts';
import { toolSpecs } from '../src/agent/tools/specs.ts';
// The real encoders and decoder, not a copy of them: a probe that hand-rolled
// the wire format would keep passing after the shipped one drifted away from
// it, which is the one failure this whole script exists to catch.
import { decode, functionOutput, responseCreate, sessionUpdate, userText } from '../src/realtime/protocol.ts';
import { addSpend, emptySpend, formatSpend } from '../src/agent/spend.ts';

const REALTIME_BASE = 'wss://api.openai.com/v1/realtime';
const DEFAULT_PROBE_MODEL = 'gpt-realtime-2.1-mini';
/** Long enough for a tool-calling first response, short enough to fail fast. */
const RESPONSE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

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
const tavilyKey = process.env.EXPO_PUBLIC_TAVILY_API_KEY ?? envLocal('EXPO_PUBLIC_TAVILY_API_KEY');
const model = process.env.EVA_REALTIME_MODEL ?? DEFAULT_PROBE_MODEL;
if (!apiKey) {
  console.error('No EXPO_PUBLIC_OPENAI_API_KEY in the environment or .env.local.');
  process.exit(1);
}

/**
 * Questions Eva cannot answer honestly without reaching for something, each
 * naming the tool it ought to provoke. Shared in spirit with probe-tools.ts:
 * the point is to compare realtime against the measured chat numbers.
 */
const DEFAULT_CASES: [string, string][] = [
  ['what time is it', 'clock'],
  ['what day is it today', 'clock'],
  ...(tavilyKey
    ? ([
        ['who won the last super bowl', 'web_search'],
        ['what is the weather in san francisco right now', 'web_search'],
      ] as [string, string][])
    : []),
  ['what did we talk about yesterday', 'memory_search'],
];

const args = process.argv.slice(2);
const cases: [string, string][] = args.length ? args.map((q) => [q, '?']) : DEFAULT_CASES;

/**
 * Running spend across the whole probe. Every question here rides one socket,
 * which is the same shape a conversation at the desk has — so the input column
 * climbing question to question is the burn rate this is meant to expose.
 */
let spend = emptySpend(Date.now());

/** Every distinct server event type seen, in first-seen order. */
const seenEvents: string[] = [];
/** Errors the server reported, printed verbatim — this is where a wrong session shape shows up. */
const errors: string[] = [];

interface Turn {
  question: string;
  expected: string;
  firstDeltaMs: number | null;
  toolCallMs: number | null;
  doneMs: number | null;
  /** Text streamed before the tool call — Eva's spoken preamble. */
  preamble: string;
  toolName: string | null;
  status: string | null;
  promptTokens: number | null;
  cachedTokens: number | null;
}

function send(ws: WebSocket, event: Record<string, unknown>): void {
  ws.send(JSON.stringify(event));
}

function note(type: string): void {
  if (!seenEvents.includes(type)) seenEvents.push(type);
}

/**
 * Time to the first content delta over chat completions — the transport being
 * replaced. Uses fetch rather than openai.ts, whose streaming path is built on
 * XMLHttpRequest because React Native cannot stream a fetch body; node has no
 * XHR, and time-to-first-token does not depend on which reader consumes it.
 */
async function chatFirstDelta(
  question: string,
  specs: ReturnType<typeof toolSpecs>,
): Promise<number | null> {
  const chatModel = process.env.EVA_CHAT_MODEL ?? envLocal('EXPO_PUBLIC_OPENAI_MODEL') ?? 'gpt-5.4-mini';
  const startedAt = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        stream: true,
        max_completion_tokens: 300,
        messages: [
          { role: 'system', content: PERSONA },
          { role: 'user', content: question },
        ],
        tools: specs.map((s) => ({
          type: 'function',
          function: { name: s.name, description: s.description, parameters: s.parameters },
        })),
      }),
    });
    if (!res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      const text = decoder.decode(value, { stream: true });
      // The first frame carrying either spoken content or a tool call is the
      // moment the round stops being silent — the same instant the realtime
      // column measures.
      if (/"(?:content|tool_calls)":\s*(?:"[^"]|\[)/.test(text)) {
        void reader.cancel();
        return Date.now() - startedAt;
      }
    }
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const specs = toolSpecs(tavilyKey, false, false);
  const started = Date.now();

  // Node's global WebSocket implements the browser constructor, so the key
  // rides in a subprotocol rather than a header. The device does not do this.
  const ws = new WebSocket(`${REALTIME_BASE}?model=${encodeURIComponent(model)}`, [
    'realtime',
    `openai-insecure-api-key.${apiKey}`,
  ]);

  /** Resolvers waiting on a server event; each is polled with every frame. */
  const waiters: ((ev: Record<string, unknown>) => void)[] = [];

  ws.onmessage = (m: MessageEvent) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(String(m.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(ev.type ?? '');
    note(type);
    if (type === 'error') errors.push(JSON.stringify(ev.error ?? ev));
    for (const w of waiters.slice()) w(ev);
  };

  const openedAt = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timed out')), CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(Date.now());
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('socket error before open — is the subprotocol auth accepted?'));
    };
  });
  console.log(`auth      · subprotocol with an sk- key accepted (open in ${openedAt - started}ms)`);

  /** Wait for the first event matching `match`, or resolve null on timeout. */
  const waitFor = (
    match: (ev: Record<string, unknown>) => boolean,
    ms: number,
    onEvent?: (ev: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown> | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        resolve(null);
      }, ms);
      const w = (ev: Record<string, unknown>) => {
        onEvent?.(ev);
        if (!match(ev)) return;
        clearTimeout(timer);
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        resolve(ev);
      };
      waiters.push(w);
    });

  const created = await waitFor((ev) => ev.type === 'session.created', CONNECT_TIMEOUT_MS);
  console.log(`session   · ${created ? 'created' : 'NO session.created — the model id may be wrong'}`);

  // The GA session shape. `type: 'realtime'` is required; output_modalities
  // replaces beta's `modalities`; tools are flat, not nested under `function`.
  // Turn detection is nulled explicitly: point 5 of the probe is whether that
  // is necessary, and the run below reports if anything auto-created a response.
  send(ws, sessionUpdate({ instructions: PERSONA, specs }));
  const updated = await waitFor((ev) => ev.type === 'session.updated' || ev.type === 'error', 10_000);
  if (!updated || updated.type === 'error') {
    console.log('session   · session.update REJECTED — see errors below, the shape is wrong');
  } else {
    console.log('session   · text-only session.update accepted, turn detection nulled');
  }

  /** Ask one question and record what the wire did. */
  const runTurn = async (question: string, expected: string, toolChoice?: 'none'): Promise<Turn> => {
    const turn: Turn = {
      question,
      expected,
      firstDeltaMs: null,
      toolCallMs: null,
      doneMs: null,
      preamble: '',
      toolName: null,
      status: null,
      promptTokens: null,
      cachedTokens: null,
    };
    let callId: string | null = null;
    send(ws, userText(question));
    const askedAt = Date.now();
    send(ws, responseCreate(toolChoice ? { toolChoice } : {}));

    const done = await waitFor(
      (ev) => ev.type === 'response.done',
      RESPONSE_TIMEOUT_MS,
      (ev) => {
        // Through the shipped decoder: this is what the device will act on, so
        // a name the decoder does not recognise shows up here as silence, in
        // exactly the way it would on the desk.
        const decoded = decode(JSON.stringify(ev));
        if (decoded?.kind === 'delta') {
          turn.firstDeltaMs ??= Date.now() - askedAt;
          // Everything streamed before the tool call is the spoken preamble.
          if (!turn.toolName) turn.preamble += decoded.text;
        }
        if (decoded?.kind === 'tool-call') {
          turn.toolCallMs ??= Date.now() - askedAt;
          turn.toolName ??= decoded.call.name;
          callId ??= decoded.call.id;
        }
      },
    );
    if (done) {
      turn.doneMs = Date.now() - askedAt;
      const decoded = decode(JSON.stringify(done));
      if (decoded?.kind === 'done') {
        turn.status = decoded.status;
        if (decoded.usage) {
          turn.promptTokens = decoded.usage.promptTokens;
          turn.cachedTokens = decoded.usage.cachedTokens;
          spend = addSpend(spend, decoded.usage, true);
        }
      }
    }

    // An unanswered tool call would sit in the conversation and change what
    // every later question is answering, so the loop is closed with a stub
    // result. No new response is requested — the probe measures the reach for
    // the tool, not what the model does with its output.
    if (callId) {
      send(ws, functionOutput(callId, 'Probe: result withheld.'));
    }
    return turn;
  };

  const turns: Turn[] = [];
  for (const [question, expected] of cases) {
    turns.push(await runTurn(question, expected));
  }

  // Point 4: does a per-response override actually suppress the tools the
  // session declared? This is the forced-answer last lap.
  const forced = await runTurn('what time is it', 'no tool — forced answer', 'none');

  console.log('');
  console.log(`model     · ${model}`);
  console.log('');
  console.log('question                                    first  tool   done   preamble  tool called');
  const row = (t: Turn) => {
    const ms = (v: number | null) => (v === null ? '  —  ' : `${String(v).padStart(4)}ms`).padEnd(7);
    console.log(
      `${t.question.slice(0, 42).padEnd(43)}${ms(t.firstDeltaMs)}${ms(t.toolCallMs)}${ms(t.doneMs)}` +
        `${(t.preamble.trim() ? 'yes' : 'NO').padEnd(10)}${t.toolName ?? '—'}${
          t.expected !== '?' && t.toolName && t.toolName !== t.expected ? ` (wanted ${t.expected})` : ''
        }`,
    );
  };
  for (const t of turns) row(t);
  console.log('');
  console.log(`tool_choice:'none' · ${forced.toolName ? `IGNORED — called ${forced.toolName}` : 'honoured, answered directly'}`);

  const withPreamble = turns.filter((t) => t.toolName && t.preamble.trim()).length;
  const withTool = turns.filter((t) => t.toolName).length;
  console.log(`preamble rate      · ${withPreamble}/${withTool} tool rounds said something first`);
  console.log('');
  console.log('preambles:');
  for (const t of turns) if (t.preamble.trim()) console.log(`  ${t.question} → ${t.preamble.trim()}`);

  // The comparison Phase 1 exists to justify: the same question, the same
  // persona and specs, over the transport being replaced. The realtime figures
  // above are on an already-open socket, which is the real condition — the
  // device dials at wake, seconds before anyone finishes talking — while chat
  // pays connection setup on every turn, which is exactly the cost being cut.
  console.log('');
  console.log('token spend on one socket (input climbs because the whole conversation is re-billed):');
  for (const t of turns) {
    console.log(
      `${t.question.slice(0, 42).padEnd(43)}${String(t.promptTokens ?? '—').padStart(6)} in` +
        `${String(t.cachedTokens ?? '—').padStart(7)} cached`,
    );
  }
  console.log(`  total · ${formatSpend(spend, Date.now())}`);
  // The rate here is machine-paced: these questions land back to back with no
  // one thinking between them, so it is an upper bound on burn, not a figure
  // to expect from the desk. The token columns above are the honest part.
  console.log('  (rate is machine-paced — questions land back to back, with no pauses)');

  console.log('');
  console.log('against chat completions (same persona, same specs, first content delta):');
  for (const t of turns) {
    const chatMs = await chatFirstDelta(t.question, specs);
    const ours = t.firstDeltaMs;
    const delta =
      ours !== null && chatMs !== null
        ? `${chatMs > ours ? '-' : '+'}${Math.abs(chatMs - ours)}ms`
        : '—';
    console.log(
      `${t.question.slice(0, 42).padEnd(43)}realtime ${String(ours ?? '—').padStart(4)}ms` +
        `   chat ${String(chatMs ?? '—').padStart(4)}ms   ${delta}`,
    );
  }

  console.log('');
  console.log('server events seen:');
  for (const type of seenEvents) console.log(`  ${type}`);
  if (errors.length) {
    console.log('');
    console.log('errors:');
    for (const e of errors) console.log(`  ${e}`);
  }

  ws.close();
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
