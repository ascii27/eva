// THROWAWAY SPIKE — can hermes-agent be the brain of a *spoken* turn?
// `npm run probe:brain`  (optionally: `npm run probe:brain -- 1 4` for a subset)
//
// Not a brain. Measurement code, written to be deleted once it has answered.
//
// The open question is latency. Pointing a brain at hermes makes every spoken
// turn a full server-side agent run, and this repo already records one of those
// at 88.7s — which is the whole reason ask_other_half returns immediately
// instead of waiting. If a conversational turn costs tens of seconds the
// experiment is over, and that answer is worth a minute rather than a build.
//
// Four other things it settles on the way, each unknown in both directions:
//
//   - whether src/agent/sse.ts survives hermes' frames unmodified. The docs
//     name three shapes our parser has never seen: `: keepalive` comment lines
//     after 10s of silence, DeepSeek-style `delta.reasoning_content` (thinking,
//     which must never reach Kokoro), and named `event: hermes.tool.progress`
//     frames. So this drives the REAL parseSse rather than a copy — the same
//     principle probe-realtime.ts follows by driving the shipped encoders.
//   - whether hermes accepts a client `tools` array at all. The docs say tools
//     run server-side and never come back as pending calls, but they never say
//     a client array is rejected. That one answer decides whether camera_look
//     and its spoken-consent gate can survive a hermes brain.
//   - whether X-Hermes-Session-Id holds history server-side, i.e. whether turn
//     two is cheaper or faster than turn one.
//   - whether what comes back is speakable: short enough to read aloud in a
//     room, and clean once speakableFromMrkdwn has flattened it.
//
// Each case costs one hermes agent run, which is not free. Hence the subset arg.

// ── MEASURED 2026-10-02, hermes at orbit-python.exe.xyz, model "hermes-agent"
//
// Latency, first spoken word (OpenAI chat baseline 512–1982ms, realtime 393–997ms):
//   conversational, cold   1,469 / 1,874 / 2,139 / 2,347 / 5,380ms  (median ~2.1s)
//   conversational, warm   1,212 / 1,788ms
//   memory question       16,349ms          ← silent for all of it
//   calendar lookup        8,796ms
// Nowhere near the 88.7s the errand design was built around. A spoken turn is
// affordable in time; a *lookup* turn is not, and nothing streamed before the
// gap on cases 3 and 4 — no preamble, so TOOL_LINES would have to cover 8–16s
// of silence off hermes.tool.progress.
//
// Cost, and this is the finding that bites: 20,570 input tokens for a
// one-sentence hello, 87,432 for the memory question, 115,269 for the calendar
// one — at a 0% cache hit rate, every single turn. history.ts's whole
// most-stable-first layout exists to earn that discount; hermes earns none of
// it, because the prefix it bills for is its own, not ours.
//
// sse.ts survives unmodified. All three documented hazards were already handled
// by the `startsWith('data:')` guard at sse.ts:63: zero reasoning_content
// frames arrived, `event: hermes.tool.progress` lines were skipped, and the six
// not-chat-shaped data frames riding alongside them parsed to no-ops rather
// than corrupting the reply. No `: keepalive` ever appeared — progress frames
// kept the stream busy. tool_progress_events is advertised in /capabilities, so
// onToolStart is derivable.
//
// Client tools: accepted without error and then silently ignored. Case 5 asked
// for the time with camera_look and clock attached; hermes ran its OWN clock
// server-side (hermes.tool.progress fired, no tool_calls came back) and the
// specs cost 20,652 wasted input tokens — 41,222 against 20,570. So camera_look
// and its spoken-consent gate cannot survive a hermes brain, and a hermes brain
// must send no tools at all.
//
// Two more, both from case 5's answer "it's two eleven in the afternoon in
// Japan": hermes' clock runs in the VM's timezone, which is wrong for a desk in
// another one and unfixable from the client because the tool is server-side.
// And X-Hermes-Session-Id really does hold history — case 2 recalled case 1's
// question with an empty messages array, so history.ts would be vestigial here.

import { readFileSync } from 'node:fs';
import { envHermesConfig, hermesHeaders } from '../src/hermes/config.ts';
import { PERSONA } from '../src/agent/persona.ts';
import { appendTurn, buildRequest, newSession } from '../src/agent/history.ts';
import { emptySse, parseSse, type SseState } from '../src/agent/sse.ts';
// Type-only: openai.ts cannot be imported at runtime from node, because its
// own `./sse` import is extensionless and node's ESM resolver will not follow
// it. Types are erased, so they cost nothing. formatUsage is three lines and is
// restated below rather than reached for — the same bypass probe-tools.ts makes.
import type { ChatUsage, ToolCall, ToolSpec } from '../src/agent/openai.ts';
import { toolSpecs } from '../src/agent/tools/specs.ts';
import { speakableFromMrkdwn } from '../src/round/speakable.ts';

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

// Same dance as probe-hermes.ts: let the real config module decide, so the probe
// exercises the device's own precedence and normalisation. Only assign when
// there is something to assign — `process.env.X = undefined` stores the *string*
// "undefined", which sails past every falsy check and POSTs to
// `undefined/chat/completions`.
for (const name of ['EXPO_PUBLIC_HERMES_BASE_URL', 'EXPO_PUBLIC_HERMES_API_KEY', 'EXPO_PUBLIC_HERMES_MODEL']) {
  if (process.env[name]) continue;
  const value = envLocal(name);
  if (value) process.env[name] = value;
}

const cfg = envHermesConfig();
if (!cfg) {
  console.error('No hermes configured. Set EXPO_PUBLIC_HERMES_BASE_URL and EXPO_PUBLIC_HERMES_API_KEY');
  console.error('in .env.local — see hermes/config/api-server.example.env for the server side.');
  process.exit(1);
}

/** A hermes agent run can legitimately take a minute; only hang-level waits fail. */
const TIMEOUT_MS = 180_000;

/**
 * Transcript scope for this run. Deliberately NOT BUNDLE_SESSION_ID: a spike
 * must not leave its chatter in the transcript the bundle refresh reads.
 */
const RUN = `eva-spike-${Date.now()}`;

const ms = (n: number) => `${n.toLocaleString()}ms`;

/** Restated from openai.ts:168 — see the import note above. */
const usageLine = (u: ChatUsage) =>
  `${u.promptTokens} in${u.cachedTokens > 0 ? ` (${u.cachedTokens} cached)` : ''} · ${u.completionTokens} out`;

/** What the raw stream contained, as opposed to what our parser made of it. */
interface Frames {
  /** `: keepalive` and friends — sse.ts should skip these. */
  comments: number;
  /** Named `event:` lines, e.g. hermes.tool.progress. */
  events: string[];
  /** data: frames carrying reasoning_content — thinking that must not be spoken. */
  reasoning: number;
  /** data: frames with no `choices` key at all, i.e. not chat-shaped. */
  offShape: number;
  dataFrames: number;
  /** Verbatim first frame, so an unexpected envelope is visible rather than inferred. */
  first: string | null;
}

interface Turnout {
  label: string;
  /** Wall clock from request to the first *content* delta — the spoken-word latency. */
  firstDeltaMs: number | null;
  /** Response headers back; separates connect/queue time from think time. */
  headersMs: number;
  totalMs: number;
  text: string;
  reasoning: string;
  usage: ChatUsage | null;
  toolCalls: ToolCall[];
  frames: Frames;
  status: number;
  error: string | null;
}

/**
 * One streamed turn, read the way the device reads it.
 *
 * node has a streaming fetch body; the other probes bypass openai.ts only
 * because chatStream is XHR, which node lacks. Everything below the socket is
 * the shipped code, so a pass here is evidence about the real path.
 */
async function streamTurn(opts: {
  label: string;
  question: string;
  sessionId: string;
  tools?: ToolSpec[];
}): Promise<Turnout> {
  const session = appendTurn(newSession(Date.now()), { role: 'user', content: opts.question }, Date.now());
  const messages = buildRequest(PERSONA, [], session);

  const frames: Frames = { comments: 0, events: [], reasoning: 0, offShape: 0, dataFrames: 0, first: null };
  const out: Turnout = {
    label: opts.label,
    firstDeltaMs: null,
    headersMs: 0,
    totalMs: 0,
    text: '',
    reasoning: '',
    usage: null,
    toolCalls: [],
    frames,
    status: 0,
    error: null,
  };

  const startedAt = Date.now();
  try {
    const res = await fetch(`${cfg!.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg!.apiKey}`,
        ...hermesHeaders(opts.sessionId),
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: cfg!.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.tools?.length ? { tools: opts.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    out.headersMs = Date.now() - startedAt;
    out.status = res.status;

    if (!res.ok || !res.body) {
      out.error = `http ${res.status}: ${(await res.text()).slice(0, 400)}`;
      out.totalMs = Date.now() - startedAt;
      return out;
    }

    let state: SseState = emptySse();
    let tail = '';
    const decoder = new TextDecoder();
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      const incoming = decoder.decode(bytes, { stream: true });

      // Tally the raw wire before the parser sees it, so "sse.ts coped" is an
      // observation about frames that actually arrived rather than a guess.
      tail += incoming;
      const lines = tail.split('\n');
      tail = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('event:')) {
          const name = line.slice(6).trim();
          if (!frames.events.includes(name)) frames.events.push(name);
        } else if (line.startsWith(':')) {
          frames.comments += 1;
        } else if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          frames.dataFrames += 1;
          if (frames.first === null) frames.first = payload.slice(0, 400);
          try {
            const frame = JSON.parse(payload) as {
              choices?: { delta?: { reasoning_content?: unknown } }[];
            };
            if (!('choices' in frame)) frames.offShape += 1;
            const think = frame.choices?.[0]?.delta?.reasoning_content;
            if (typeof think === 'string' && think.length) {
              frames.reasoning += 1;
              out.reasoning += think;
            }
          } catch {
            /* the parser's problem, and it is built to skip these */
          }
        }
      }

      const step = parseSse(state, incoming);
      state = step.state;
      if (step.chunk.deltas.length && out.firstDeltaMs === null) out.firstDeltaMs = Date.now() - startedAt;
      out.text += step.chunk.deltas.join('');
      if (step.chunk.usage) out.usage = step.chunk.usage;
      if (step.chunk.toolCalls.length) out.toolCalls = step.chunk.toolCalls;
    }
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  out.totalMs = Date.now() - startedAt;
  return out;
}

function report(t: Turnout): void {
  console.log(`\n── ${t.label}`);
  if (t.error) {
    console.log(`   ✗ ${t.error}`);
    return;
  }
  const ttft = t.firstDeltaMs === null ? 'never spoke' : ms(t.firstDeltaMs);
  console.log(`   headers ${ms(t.headersMs)}   first word ${ttft}   total ${ms(t.totalMs)}`);
  if (t.usage) {
    const hit = t.usage.promptTokens ? Math.round((t.usage.cachedTokens / t.usage.promptTokens) * 100) : 0;
    console.log(`   ${usageLine(t.usage)}   cache hit ${hit}%`);
  } else {
    console.log('   usage not reported — stream_options.include_usage is ignored here');
  }
  const f = t.frames;
  console.log(
    `   wire: ${f.dataFrames} data, ${f.comments} comment, ${f.reasoning} reasoning, ` +
      `${f.offShape} not-chat-shaped${f.events.length ? `, events[${f.events.join(' ')}]` : ''}`,
  );
  if (t.toolCalls.length) {
    console.log(`   tool_calls: ${t.toolCalls.map((c) => `${c.name}(${c.arguments.slice(0, 60)})`).join(', ')}`);
  }
  if (t.reasoning) console.log(`   thinking leaked to a separate field (${t.reasoning.length} chars) — good, not spoken`);
  const spoken = speakableFromMrkdwn(t.text);
  console.log(`   spoken (${spoken.length} chars): ${spoken.slice(0, 300)}${spoken.length > 300 ? '…' : ''}`);
  if (!t.text.trim()) console.log('   ⚠  nothing in delta.content — the answer did not arrive where Kokoro reads it');
  if (spoken !== t.text.trim()) console.log('   (speakableFromMrkdwn changed it, so there was markdown to flatten)');
}

// ── run

console.log(`hermes at ${cfg.baseUrl}, model "${cfg.model}"`);
console.log(`transcript scope ${RUN} (throwaway — not the bundle's)`);

const caps = await fetch(`${cfg.baseUrl}/capabilities`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
if (caps && typeof caps === 'object' && 'features' in caps) {
  console.log(`features: ${JSON.stringify((caps as { features: unknown }).features)}`);
}

const CASES: { n: number; run: () => Promise<Turnout> }[] = [
  {
    // The floor. No lookup, no tools — the best hermes can possibly do, and the
    // number the whole experiment lives or dies on.
    n: 1,
    run: () =>
      streamTurn({
        label: '1 · conversational, no lookup',
        question: 'Say hello and tell me how you are, in one short sentence.',
        sessionId: `${RUN}-chat`,
      }),
  },
  {
    // Same session id as case 1: does the server hold the history, and is turn
    // two warmer?
    n: 2,
    run: () =>
      streamTurn({
        label: '2 · second turn, same session id',
        question: 'And what did I just ask you?',
        sessionId: `${RUN}-chat`,
      }),
  },
  {
    n: 3,
    run: () =>
      streamTurn({
        label: '3 · memory question',
        question: 'What do you remember about what I am working on?',
        sessionId: `${RUN}-memory`,
      }),
  },
  {
    // The realistic worst case: a real agent run with a real tool in it.
    n: 4,
    run: () =>
      streamTurn({
        label: '4 · forced tool run (calendar)',
        question: 'What is on my calendar for the rest of today?',
        sessionId: `${RUN}-calendar`,
      }),
  },
  {
    // The undocumented one. 400 / silently ignored / actually emits tool_calls —
    // and camera_look's fate rides on the answer.
    n: 5,
    run: () =>
      streamTurn({
        label: '5 · client tools attached',
        question: 'What time is it? Use a tool if you have one.',
        sessionId: `${RUN}-tools`,
        tools: toolSpecs(null, true, false),
      }),
  },
];

const picked = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const cases = picked.length ? CASES.filter((c) => picked.includes(c.n)) : CASES;
console.log(`running ${cases.length} of ${CASES.length} cases (pass numbers as args to subset)`);

const results: Turnout[] = [];
for (const c of cases) {
  const t = await c.run();
  results.push(t);
  report(t);
}

// ── verdict

console.log('\n── summary');
for (const t of results) {
  const ttft = t.error ? 'error' : t.firstDeltaMs === null ? 'silent' : ms(t.firstDeltaMs);
  console.log(`   ${t.label.padEnd(36)} first word ${ttft.padStart(10)}   total ${ms(t.totalMs).padStart(10)}`);
}

const chat = results.find((t) => t.label.startsWith('1'));
if (chat && !chat.error && chat.firstDeltaMs !== null) {
  // Baselines recorded in CLAUDE.md: chat completions 512–1982ms, realtime 393–997ms.
  const verdict =
    chat.firstDeltaMs < 3_000 ? 'VIABLE — design the brain' : chat.firstDeltaMs < 8_000 ? 'MARGINAL' : 'DEAD — keep errands';
  console.log(`\n   conversational first word ${ms(chat.firstDeltaMs)} vs OpenAI chat 512–1982ms → ${verdict}`);
}

const toolCase = results.find((t) => t.label.startsWith('5'));
if (toolCase) {
  console.log(
    `\n   client tools → ${
      toolCase.error
        ? `rejected (${toolCase.error.slice(0, 120)})`
        : toolCase.toolCalls.length
          ? 'ACCEPTED and emitted tool_calls — camera_look could survive'
          : 'accepted but silently ignored — no client tools, camera_look cannot survive'
    }`,
  );
}
