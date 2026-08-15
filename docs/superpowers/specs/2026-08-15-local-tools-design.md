# Local tools — design

Status: implemented, **not yet verified on the device**. The pure layers are
covered (335 tests green, typecheck clean), but nothing below — the preamble
actually arriving as content alongside a tool call, the `hold()` fix, Tavily's
live response shape — has been exercised on the phone. The device checks at the
bottom of this document are all still open.

Two things changed during implementation, both because tools made a previously
unreachable path reachable:

- The last lap is offered no tools, forcing an answer out of whatever was
  gathered. `MAX_STEPS` could otherwise exhaust with nothing said, after Eva had
  promised out loud to look something up.
- `useEcho` no longer treats an open `speech.current` as proof the answer
  started. A tool round clears `spoken` at the tool boundary, so an empty one
  means only a preamble played — and an apology beats stopping mid-promise.

A `chatStream.onToolCall` callback in the original design was dropped as
unnecessary: `useAgent` already drives the lap loop, so it fires `onToolStart`
itself when a lap resolves with tool calls, a few milliseconds later and with
one less API surface.

Follows [2026-08-15-streaming-speech-design.md](2026-08-15-streaming-speech-design.md),
whose closing note named this as the next round — and named the fork it starts
with.

## Problem

The local agent loop is the default brain and answers in about a second, but it
can only talk. `persona.ts` tells Eva she has no tools and to say so plainly;
`useAgent.ts` carries a correctly-shaped but unreachable tool loop; `asides.ts`
has a `TOOL_LINES` table keyed to Slack tool-echo labels that nothing on the
local path ever calls.

Two things make this a design rather than an afternoon's typing.

**Defining the first tool silently turns streaming off.** `useAgent.ts` guards
on `TOOLS.length === 0` and falls back to non-streaming `chat()` whenever tools
are offered, because `chatStream` cannot reassemble tool-call arguments
fragmented across SSE frames. The guard was deliberate — adding a tool must not
silently break streaming — but its flip side is that the moment `TOOLS` is
non-empty, the latency win verified on the device is gone.

**Eva should say what she is about to do.** "Let me check my memory…", "I'm
going to look that up…" — before a tool runs, rather than going silent for
several seconds while the face sits in `thinking`.

## Why not the OpenAI Agents SDK

Worth writing down, because the answer is less obvious than expected.

`@openai/agents-core` ships an official `react-native` export condition with a
real shim — a no-op `AsyncLocalStorage`, a DOM-free event emitter, stubbed MCP
transports. So "it doesn't run on React Native" is not the argument.

The argument is three other things:

1. **It would likely cost the streaming just verified.** The SDK's model calls
   go through `openai@7`, whose exports map has *no* react-native condition and
   whose `Stream` reads `response.body.getReader()`. That is exactly the RN gap
   that forced `chatStream` onto XHR. The SDK's streaming path is the part most
   likely to fall over on the device, and it is the part we least want to lose.
2. **It wants to own state we deliberately own.** The SDK has Sessions and
   history management. `history.ts` is not generic history: its message layout
   keeps the leading system block byte-identical for a whole session so prompt
   caching pays, and `applyCompaction` drops by *count* so turns arriving
   mid-summarization survive. Handing that to the SDK trades a documented cost
   property for a black box.
3. **Large surface for the one missing part.** Handoffs, guardrails, tracing
   (which uploads to OpenAI by default), sandboxes, realtime — none of it is
   wanted on a desk appliance. What is actually missing is SSE accumulation.

The SDK earns its keep with multi-agent orchestration on a Node server. This is
one device, one agent, and a hard streaming constraint the SDK does not share.

## Decisions

- **Tools:** memory search, web search (Tavily), clock/date. No Slack → hermes
  handoff yet; that one needs the round contract to nest, and is its own round.
- **The preamble is model-authored.** When the model calls a tool it emits
  `content` *and* `tool_calls` in the same response; the content arrives on the
  existing `onDelta` path and speaks through the stream already built. Eva's own
  words, specific to the actual question, no new speech machinery. `TOOL_LINES`
  is retained purely as the long-wait fallback.
- **Tool traffic is ephemeral.** Only the user turn and Eva's final spoken reply
  are appended to the `Session`. The `tool_calls`/`tool` messages live in the
  request array for one round and are discarded. `history.ts`, `planCompaction`,
  and the cache layout are untouched. Cost: a follow-up cannot reference raw
  tool output — but Eva's answer already summarized it aloud.
- **Tavily** over Brave or Exa: it returns a synthesized answer plus a few clean
  snippets rather than a page of links, which is what a spoken reply needs.

## Design

### Streaming tool calls

OpenAI fragments tool calls by array index. The first frame for an index carries
`id` and `function.name`; later frames append `function.arguments` string
pieces, split at arbitrary points including mid-JSON-token.

`sse.ts` accumulates them: `SseState` gains a per-index accumulator, and
`SseChunk` reports assembled calls only once the stream says it is finished
(`finish_reason: 'tool_calls'`, or `[DONE]`), so partial JSON is never handed
out. The existing posture holds exactly — a malformed frame is skipped rather
than thrown, because by the time one arrives audio is usually already playing.

`chatStream` then forwards `tools` in the request, returns the assembled
`toolCalls` and an `AssistantMessage` shaped for the next lap, and gains an
`onToolCall` callback fired once the calls are complete.

`ask()` loses the `TOOLS.length === 0` guard and its non-streaming branch
entirely: every lap streams. `chat()` remains, serving the two summarizers.

### The tool gap

This is the part that had to be read rather than assumed.

`audioOut.ts` re-arms a stall watchdog at `remainingSeconds + 5` on every buffer
end. Once the preamble's last buffer plays, `remainingSeconds ≈ 0` — so roughly
five seconds of silence calls `finish(true)` → `onDrained` → `onDone` →
`finishSpoken`, settling the face and, in conversation mode, re-opening the mic
*while the tool is still running*. A Tavily search plus the second lap's
time-to-first-token crosses five seconds often enough to matter.

The watchdog is right to exist — it is what stops a dead stream wedging the face
in `speaking` and deafening the appliance. It simply cannot distinguish
"playback died" from "we are deliberately paused." Only the caller knows that,
so the caller says so: a `hold(on)` signal threaded from `useEcho` through
`tts.ts` and `kokoro.ts` to the sink, where it swaps the watchdog window for one
longer than `ASK_TIMEOUT_MS` — so the ask's own abort is always what ends a
stuck round.

`stopAutomatically` is **not** a problem here, which is worth stating because it
looks like one. `runStream` reads `inputFinished()`, which is only true once
`end()` has been called, and `useEcho` only calls `end()` when the whole ask
resolves. The Kokoro stream already survives the gap correctly.

The alternative considered was segmenting the reply — ending the stream when a
tool starts and opening a fresh one for the answer. It touches only `useEcho`,
but `speakStream()` calls `stopSpeaking()` on open, so a fast tool would cut the
preamble off mid-word. Two of the three tools are fast.

### The round contract

`AskOptions` gains one optional callback:

```ts
/** Tool dispatch is starting; the reply will pause here. */
onToolStart?: (names: string[]) => void;
```

Slack never calls it, exactly as it never calls `onDelta`. No capability flag —
that remains the design.

`useEcho` responds by flushing the pending sentence (the preamble may not end in
terminal punctuation, and otherwise it would sit in the buffer and get prefixed
onto the answer's first sentence), resetting the sentence state, holding the
stream, and calling `noteToolActivity` — which is what finally gives
`TOOL_LINES` a source on the local path. The next content delta releases the
hold.

The invariant to preserve is the one `useEcho` already documents: every exit
from `askEva` either settles the face or leaves an open `speech.current` whose
drain callback will. A held stream is still an open stream, so the existing
guard holds — but `clearRoundSpeech()` must drop the hold along with the stream,
or a cancelled round leaves a held sink alive.

The preamble is spoken but not recorded as part of the assistant turn: it
belongs to the discarded tool-lap message, consistent with keeping tool traffic
ephemeral.

### The registry

`src/agent/tools/`, following the same pure-policy / effectful-shell split as
everything else — `searchMemories`, `formatResults`, and the clock's formatter
are pure and unit-tested; the filesystem and `fetch` wrappers around them stay
thin.

Two constraints worth stating because they are easy to violate later:

**The spec list must be stable for the whole session.** Tool specs are part of
OpenAI's cached prefix. A list that varies per turn would cost exactly the
caching discount `history.ts` is built around. It is built once at bring-up from
what is configured — which is also why the search tool is absent entirely when
no Tavily key is set, rather than present and failing.

**A tool never throws.** Failures come back as an error string in the tool
message content, so the model can say "I couldn't reach it" instead of the round
dying.

### Persona

The closing paragraph of `PERSONA` ("You are talking, not acting. You have no
tools here…") becomes wrong the moment tools exist. It is replaced with what she
can now reach (her memory of past conversations, the web, the clock), what she
still cannot (calendar, Slack, Notion, the terminal — say so plainly rather than
implying she acted), and the preamble rule: before calling a tool, say one short
sentence about what you are about to do, in your own words, then call it.

The voice rules above it are shared with `docs/eva-proactive-prompt.md` and are
unchanged — the tool paragraph is not a voice rule, so that document needs no
matching edit this time.

## Verification

Pure, in CI:

- Tool calls fragmented across frames reassemble by index; arguments split
  mid-JSON-token; interleaved content and tool_call deltas; a malformed frame
  skipped without losing the frames around it; two parallel tool calls.
- `searchMemories` ranking, empty corpus, no match.
- `formatResults` against a captured Tavily fixture; empty results; a missing
  `answer` field.
- The clock's output is speakable — no ISO strings, no 24-hour times.
- `history.test.ts` and `store.test.ts` pass **unchanged**. That is the evidence
  the caching layout and compaction were not disturbed.

On the device:

- A no-tool turn's streaming latency is unchanged from the current build. This
  is the regression that matters most.
- A fast tool ("what time is it") produces no audible seam and no truncated
  preamble.
- A slow web search does not settle the round mid-gap and does not re-open the
  mic — the `hold()` fix, visible as the face staying put rather than flashing
  `pleased`.
- With asides on, a tool running past the aside interval produces a
  `TOOL_LINES` line rather than an `OPENERS` one.
- The memory tool finds something from an older archived conversation.
- With no Tavily key the search tool is absent and Eva says she cannot search;
  with a bad key the tool error is spoken gracefully rather than wedging.
- A barge-in during a tool gap drops the hold and leaves no held sink alive.
- The per-round usage line sums across laps.
