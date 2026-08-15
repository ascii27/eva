# Streaming speech — design

Status: implemented and verified on the device (2026-08-15). Streaming replies
begin speaking before generation finishes and the interaction reads as good in real
use. Two checks from the list below were flagged as the likeliest to need tuning and
were not separately confirmed: barge-in mid-reply (the 2s `streamTail` wait now tears
down a *live* native stream) and the short-reply settle. Neither has misbehaved in
use.

Follows [2026-08-15-local-agent-loop-design.md](2026-08-15-local-agent-loop-design.md),
which named this as the largest remaining latency win.

## Problem

The local agent loop cut a round from 10–90s to about a second, but the
remaining second is structured badly: the whole reply generates, and *then* the
whole reply is synthesized. Both costs scale with reply length, so a five-
sentence answer is markedly slower to *start* than a one-sentence answer.

The goal is to make time-to-first-audio roughly **constant** — first token, first
complete sentence, first audio chunk — independent of how long the reply turns
out to be. Secondary benefit: no gap between sentences, because synthesis of
sentence N+1 overlaps playback of sentence N.

## What the platform allows

Three facts, established by reading the libraries rather than assuming, that
between them determine the whole design.

**1. Kokoro already partitions on sentence boundaries, natively.**
`Kokoro.cpp:197-216` scans its input buffer for the last end-of-sentence
character and synthesizes up to it, deliberately avoiding mid-sentence chunks.
`streamInsert` appends to that buffer under a mutex (`Kokoro.cpp:408`), so it is
safe to call repeatedly during a live stream. We therefore do **not** need a JS
sentence queue for Kokoro's sake.

**2. But `stopAutomatically: true` closes the stream the moment the buffer
empties** (`Kokoro.cpp:193-195`), which is what `kokoro.ts:155` passes today. A
second `streamInsert` after a brief pause would land on a dead stream. The fix
is `stopAutomatically: false` plus `streamStop(false)` when input is done —
`streamStop(false)` sets `stopOnEmptyBuffer_ = true` (`Kokoro.cpp:413-419`),
which is precisely "no more input coming, drain what you have and exit."

**3. React Native's `fetch` cannot stream a response body.** There is no
`textStreaming` support in this RN version. `XMLHttpRequest` can:
`__didReceiveIncrementalData` *appends* to the response
(`XMLHttpRequest.js:379-399`), so `responseText` accumulates and `onprogress`
fires after each append. Two gotchas, both load-bearing:

- `onprogress` **must be assigned before `send()`** — `send()` computes
  `incrementalEvents` from whether the handler is already set
  (`XMLHttpRequest.js:571-573`). Assign it afterwards and the response arrives
  in one lump, silently defeating the whole feature.
- Because `responseText` accumulates, the reader must track a consumed offset
  and slice, not re-read the whole buffer.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Aside opener | Delayed behind `ASIDE_OPENER_DELAY_MS` (1500) | With ~0.3s to first token, an immediate opener would talk over and delay the answer. Also fixes the same wart on the Slack path, where the opener fires even when Eva answers quickly. |
| Fallback voice | Buffer to completion, then speak whole | expo-speech has no streaming API. This is exactly today's behavior and today's latency — honest degradation, and the appliance runs Kokoro anyway. |
| SSE transport | Hand-rolled XHR + pure parser | No new dependency, and the part with real edge cases (split frames, `[DONE]`, the usage chunk) becomes a pure function with actual tests. |
| Sentence splitting | Yes, but for the sanitizer | Not for Kokoro — see fact 1. `speakableFromMrkdwn` cannot run on half a `**bold**` span, so text is flattened only at sentence boundaries. |
| Transports that can't stream | Self-configuring, no capability flag | `useEcho` always passes `onDelta` and opens the speech stream lazily on the *first* delta. Slack simply never calls it and keeps today's path, unchanged. |

## Architecture

### Data path

```
OpenAI SSE  ──XHR onprogress──►  parseSse (pure)  ──text deltas──►  useAgent onDelta
                                                                          │
useEcho ◄─────────────────────────────────────────────────────────────────┘
   │  sentence buffer (pure): accumulate → flatten complete sentences
   ▼
tts.speakStream().push(sentence)
   │
   ├─ Kokoro ready → streamInsert into ONE live native stream
   │                    └─ audioOut sink → continuous playback
   │                          onFirstAudio → setMode('speaking') + onLatency
   │                          onDrained    → settle, or reopen mic for follow-up
   └─ otherwise    → buffer; speak whole text on end()
```

### New modules, both pure

**`src/agent/sse.ts`**

```ts
export interface SseState { buffer: string }
export interface SseChunk { deltas: string[]; usage: ChatUsage | null; done: boolean }
export function parseSse(state: SseState, incoming: string): { state: SseState; chunk: SseChunk }
```

Owns: frames split across `onprogress` boundaries, several events in one chunk,
`data: [DONE]`, the trailing usage-only chunk (which has an empty `choices`
array), and malformed JSON — skipped rather than thrown, since one bad frame
should not lose a reply that is already half spoken.

`ChatUsage` stays defined in `openai.ts`; `sse.ts` reaches it with a **type-only**
import. That is deliberate — the type import is erased at runtime, so it does not
create a cycle with `openai.ts`'s real import of `parseSse`. Don't "fix" it by
duplicating the type.

**`src/round/sentences.ts`**

```ts
export interface SentenceState { pending: string }
export const SENTENCE_END = '.?!;…';        // matches Kokoro's kEndOfSentenceCharacters
export const MAX_PENDING_CHARS = 200;
export function pushText(state: SentenceState, text: string): { state: SentenceState; sentences: string[] }
export function flushPending(state: SentenceState): string
```

Emits **flattened** sentences (`speakableFromMrkdwn` applied), so what reaches
Kokoro is speech-ready and always terminated — which also means Kokoro's
`kStreamMaxSkippedIterations` mid-sentence fallback (~600ms) never fires.

Rules: split after a terminator followed by whitespace or end-of-input; do not
split a decimal (`3.5`); force-flush at the last space once `pending` exceeds
`MAX_PENDING_CHARS`, so an unpunctuated run cannot stall audio indefinitely.

### Changed modules

**`src/agent/openai.ts`** — add `chatStream(opts & { onDelta })` on XHR,
returning the same `ChatReply` shape so `useAgent` stays parallel to the
non-streaming path. Sends `stream: true` and `stream_options: { include_usage:
true }` — without the latter, streamed responses carry no usage at all and the
`agent · … cached` transcript line silently goes blank. Existing `chat()` is
untouched and still serves both summarizers, which have no reason to stream.

**`src/speech/kokoro.ts`** — new:

```ts
export function speakStreamWithKokoro(handlers: KokoroSpeakHandlers): { push(text: string): void; end(): void }
```

Opens the sink and the native stream with `stopAutomatically: false`,
`streamInsert`s each push, and calls `streamStop(false)` on `end()`. The
existing `speakWithKokoro(text, handlers)` becomes a wrapper — `push(text);
end()` — so there is one streaming implementation rather than two paths.

Pushes arriving before the `streamTail` wait resolves are queued and inserted
once the stream is live; a push after `end()` is ignored.

**`src/speech/tts.ts`** — add `speakStream(cb: SpeakCallbacks): SpeechStream`
where `SpeechStream = { push(text): void; end(): void }`. Kokoro-ready routes to
the streaming engine; otherwise pushes accumulate and `end()` calls the existing
`speakSystem` with the joined text. `stopSpeaking()` terminates either shape.
`speak()` is unchanged, still serving the dev Speak-test and `announce()`.

The pre-audio Kokoro fallback (`tts.ts:111-120`, retry on the system voice when
nothing was audible yet) is preserved for the streaming path: text pushed so far
is retained, so a failure before first audio can still be spoken whole by the
system voice.

**`src/speech/asides.ts`** — `AsideState` gains `startedAt` and `openerSpoken`.
The opener moves out of a separate immediate call into `decideAside`, gated on
`ASIDE_OPENER_DELAY_MS`, so there is one decision function instead of two:

```ts
export function beginAside(now: number): AsideState        // replaces openAside; returns state only
export function decideAside(now, state, rand): { say: string | null; state: AsideState }
```

**`src/speech/useEcho.ts`** — `askEva` passes `onDelta` and holds the sentence
state plus the open `SpeechStream` in refs. First delta opens the stream and
clears any pending asides. On resolve: if the stream was opened, `flushPending`
then `end()`; if not, fall back to today's `deliver()`. Settling moves from
`speak`'s `onDone` to the stream's drain callback, and `onLatency` fires on first
audio rather than on utterance start.

**`src/round/ask.ts`, `src/agent/useAgent.ts`** — `ask` gains an optional second
parameter: `ask(text, opts?: { onDelta?: (chunk: string) => void })`. The Slack
lambda in `FaceScreen` needs no change, since a narrower function still satisfies
the wider type.

## Hazards

- **Superseded rounds.** `onDelta` checks its captured epoch before pushing;
  cancellation routes through `stopSpeaking()` → `streamStop(true)`. Unchanged
  guard, newly applied to a live stream.
- **The 2s `streamTail` wait** (`kokoro.ts:117-127`) now lands on the critical
  path more often: a barge-in must tear down a *live* native stream before the
  next round can speak. Existing mechanism, newly load-bearing — the most likely
  thing to need retuning on device.
- **Mid-reply stream failure.** Audio has already played, so the spoken part
  stands: log `agent · stream failed mid-reply`, record the partial text in
  history so Eva knows what she said, and do **not** speak an error line over it.
- **`onSaid`** fires once on stream end, keeping one `said ·` line per reply as
  today. It uses the resolved result's `speakable` on success; on a mid-stream
  failure there is no resolved reply, so it uses the text actually spoken —
  whatever was pushed — rather than firing not at all.
- **Mouth animation** is unchanged: `onBoundary` was always expo-speech-only and
  Kokoro never fired it.
- **A reply with no terminal punctuation** ("Yes") emits nothing until `end()`,
  then speaks whole. Correct, and streaming was never going to help there.

## Testing

Pure modules get real coverage; the rest follows existing precedent and is
verified on device.

- `sse.test.ts` — frames split mid-line across chunks, several events per chunk,
  `[DONE]`, usage-only final chunk, malformed JSON skipped, content-free role
  chunk.
- `sentences.test.ts` — a `**bold**` span spanning two deltas flattens
  correctly, decimals survive, force-flush past `MAX_PENDING_CHARS`, terminator
  set matches Kokoro's, `flushPending` returns the tail.
- `asides.test.ts` — extended: no opener before the grace period, opener after
  it, filler cadence unchanged afterwards.

Not unit-tested, matching the repo's existing boundary: the XHR wiring, the
Kokoro stream lifecycle, and `useEcho` timing.

On-device verification: a deliberately long reply ("tell me about your day in
five sentences") should begin speaking well before it finishes generating, with
no audible gaps between sentences; the `latency` line's total should drop while
`eva` stays similar; asides should no longer fire on fast local rounds but
should still fire on a slow Slack round.

## Out of scope

- **Barge-in** — interrupting Eva by speaking. Still deferred, as in the
  continuous-conversation spec.
- **Streaming for the system voice.**
- **Streaming tool narration** — no tools exist yet.
