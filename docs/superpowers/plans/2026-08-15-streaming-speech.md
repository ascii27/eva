# Streaming Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make time-to-first-audio roughly constant instead of scaling with reply length, by streaming tokens from OpenAI and feeding one long-lived Kokoro stream so synthesis of sentence N+1 overlaps playback of N.

**Architecture:** Two new pure modules (an SSE frame parser and an incremental sentence buffer that flattens markdown at sentence boundaries) feed a new streaming path through the existing layers: `openai.chatStream` on XMLHttpRequest → `useAgent.ask`'s `onDelta` → `useEcho` → `tts.speakStream` → `kokoro.speakStreamWithKokoro` → the existing `audioOut` sink. Transports that cannot stream (Slack) simply never call `onDelta`, and `useEcho` falls back to today's whole-utterance path.

**Tech Stack:** React Native 0.86 + Expo SDK 57, TypeScript 6, Jest (`jest-expo` preset; `@jest/globals` imports — TS 6 does not auto-include `@types` globals), react-native-executorch 0.9.3 (Kokoro-82M), react-native-audio-api.

**Spec:** `docs/superpowers/specs/2026-08-15-streaming-speech-design.md`

## Global Constraints

- Pure modules (`sse.ts`, `sentences.ts`, `asides.ts`) must have **no React imports** and no side effects; randomness and clocks are caller-passed.
- Tests import from `@jest/globals` (e.g. `import { describe, expect, it } from '@jest/globals';`).
- **`xhr.onprogress` must be assigned before `xhr.send()`** — RN computes `incrementalEvents` from whether the handler is already set (`XMLHttpRequest.js:571-573`). Assign it after `send()` and the body arrives in one lump, silently defeating the feature.
- **`xhr.responseText` accumulates** (`XMLHttpRequest.js:379-399`), so the reader tracks a consumed offset and slices; it must never re-parse the whole buffer.
- Kokoro streaming requires **`stopAutomatically: false`** and **`streamStop(false)`** to finish. `stopAutomatically: true` (today's value at `kokoro.ts:155`) exits the native loop as soon as the buffer empties (`Kokoro.cpp:193-195`).
- `SENTENCE_END = '.?!;…'` must stay equal to Kokoro's `kEndOfSentenceCharacters` (`Constants.h:40-44`) so every push lands on a boundary the native partitioner accepts immediately.
- `stream_options: { include_usage: true }` is required on streaming requests, or usage is absent entirely and the `agent · … cached` transcript line goes blank.
- `ASIDE_OPENER_DELAY_MS = 1_500`. `ASIDE_INTERVAL_MS` stays `12_000`.
- The aside path must **never touch `convWindow` or `voiceRound`** in `useEcho` — asides are cosmetic.
- Every epoch bump in `useEcho` must clear aside state **and** the open speech stream.
- Verification: `npx jest <file>` for one suite, `npm test` for all, `npx tsc --noEmit` for types. All three must be green before each commit.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `src/agent/sse.ts` (new) | **Pure.** Parse SSE frames out of an accumulating text buffer into content deltas, usage, and a done flag. |
| `src/round/sentences.ts` (new) | **Pure.** Accumulate streamed text; emit complete, markdown-flattened sentences. |
| `src/agent/openai.ts` | Add `chatStream` (XHR + SSE). Existing `chat` untouched. |
| `src/round/ask.ts` | Add `AskOptions` so `ask` can accept `onDelta`. |
| `src/agent/useAgent.ts` | Route to `chatStream` when a delta sink is supplied; record partial replies on mid-stream failure. |
| `src/speech/kokoro.ts` | Add `speakStreamWithKokoro`; re-express `speakWithKokoro` as a wrapper over it. |
| `src/speech/tts.ts` | Add `speakStream` facade; Kokoro streams, system voice buffers to completion. |
| `src/speech/asides.ts` | Replace `openAside` with `beginAside`; move the opener into `decideAside` behind a grace period. |
| `src/speech/useEcho.ts` | Lazily open a speech stream on first delta; settle on drain; extract `finishSpoken` shared with `deliver`. |

---

### Task 1: Pure SSE parser

**Files:**
- Create: `src/agent/sse.ts`
- Test: `src/agent/__tests__/sse.test.ts`

**Interfaces:**
- Consumes: `type ChatUsage` from `src/agent/openai.ts` — **type-only import**, deliberately, so it does not form a runtime cycle with `openai.ts`'s real import of `parseSse`.
- Produces (used by Task 4):
  - `interface SseState { buffer: string }`
  - `interface SseChunk { deltas: string[]; usage: ChatUsage | null; done: boolean }`
  - `emptySse(): SseState`
  - `parseSse(state: SseState, incoming: string): { state: SseState; chunk: SseChunk }`

- [ ] **Step 1: Write the failing test**

Create `src/agent/__tests__/sse.test.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { emptySse, parseSse } from '../sse';

/** One OpenAI content frame. */
const frame = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('parseSse', () => {
  it('reads a single complete frame', () => {
    const { chunk } = parseSse(emptySse(), frame('Hello'));
    expect(chunk.deltas).toEqual(['Hello']);
    expect(chunk.done).toBe(false);
  });

  it('reads several frames arriving in one chunk', () => {
    const { chunk } = parseSse(emptySse(), frame('Hello') + frame(' there'));
    expect(chunk.deltas).toEqual(['Hello', ' there']);
  });

  it('carries a frame split mid-line across two chunks', () => {
    const whole = frame('Hello');
    const cut = Math.floor(whole.length / 2);
    const first = parseSse(emptySse(), whole.slice(0, cut));
    expect(first.chunk.deltas).toEqual([]);
    const second = parseSse(first.state, whole.slice(cut));
    expect(second.chunk.deltas).toEqual(['Hello']);
  });

  it('carries a partial frame while still emitting the complete one before it', () => {
    const partial = frame('later').slice(0, 12);
    const { state, chunk } = parseSse(emptySse(), frame('now') + partial);
    expect(chunk.deltas).toEqual(['now']);
    expect(state.buffer).toBe(partial);
  });

  it('flags [DONE]', () => {
    const { chunk } = parseSse(emptySse(), 'data: [DONE]\n\n');
    expect(chunk.done).toBe(true);
    expect(chunk.deltas).toEqual([]);
  });

  it('reads the trailing usage-only chunk', () => {
    const raw = `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 412, completion_tokens: 89, prompt_tokens_details: { cached_tokens: 256 } },
    })}\n\n`;
    const { chunk } = parseSse(emptySse(), raw);
    expect(chunk.usage).toEqual({ promptTokens: 412, cachedTokens: 256, completionTokens: 89 });
    expect(chunk.deltas).toEqual([]);
  });

  it('defaults a missing cached_tokens to zero', () => {
    const raw = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`;
    expect(parseSse(emptySse(), raw).chunk.usage).toEqual({
      promptTokens: 10,
      cachedTokens: 0,
      completionTokens: 2,
    });
  });

  it('ignores the opening role-only frame', () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual([]);
  });

  it('skips a malformed frame without losing the frames around it', () => {
    const raw = frame('before') + 'data: {not json\n\n' + frame('after');
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['before', 'after']);
  });

  it('tolerates CRLF line endings', () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\r\n\r\n`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['x']);
  });

  it('ignores SSE comment and event lines', () => {
    const raw = `: keep-alive\nevent: message\n${frame('x')}`;
    expect(parseSse(emptySse(), raw).chunk.deltas).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/agent/__tests__/sse.test.ts`
Expected: FAIL — "Cannot find module '../sse'".

- [ ] **Step 3: Write minimal implementation**

Create `src/agent/sse.ts`:

```typescript
// Server-sent-event framing for the streaming chat path — no React, no I/O,
// unit-tested.
//
// The reader hands us whatever new text arrived on the socket, which may end
// mid-frame; we return the complete frames and keep the remainder for next
// time. A malformed frame is skipped rather than thrown: by the time one
// arrives, part of the reply is usually already being spoken aloud, and losing
// the rest of it over one bad line would be worse than a missing word.

import type { ChatUsage } from './openai';

export interface SseState {
  /** Text after the last complete line — a frame we have not fully received. */
  buffer: string;
}

export interface SseChunk {
  deltas: string[];
  usage: ChatUsage | null;
  done: boolean;
}

export function emptySse(): SseState {
  return { buffer: '' };
}

export function parseSse(state: SseState, incoming: string): { state: SseState; chunk: SseChunk } {
  const lines = (state.buffer + incoming).split('\n');
  // The final element is either '' (input ended on a newline) or a partial
  // line; either way it is not yet safe to parse.
  const buffer = lines.pop() ?? '';

  const deltas: string[] = [];
  let usage: ChatUsage | null = null;
  let done = false;

  for (const raw of lines) {
    const line = raw.trim(); // also strips the \r of a CRLF stream
    if (!line.startsWith('data:')) continue; // blank separators, ': ' comments, 'event:' lines
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const frame = json as {
      choices?: { delta?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const content = frame.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0) deltas.push(content);
    if (frame.usage) {
      usage = {
        promptTokens: frame.usage.prompt_tokens ?? 0,
        cachedTokens: frame.usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: frame.usage.completion_tokens ?? 0,
      };
    }
  }

  return { state: { buffer }, chunk: { deltas, usage, done } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/agent/__tests__/sse.test.ts` — Expected: PASS, 11 tests.
Run: `npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/agent/sse.ts src/agent/__tests__/sse.test.ts
git commit -m "feat: pure SSE frame parser

Parses OpenAI streaming frames out of an accumulating buffer: frames split
across socket reads, several per read, [DONE], the trailing usage-only
chunk, and malformed frames skipped rather than thrown -- by the time one
arrives the reply is usually already being spoken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure incremental sentence buffer

**Files:**
- Create: `src/round/sentences.ts`
- Test: `src/round/__tests__/sentences.test.ts`

**Interfaces:**
- Consumes: `speakableFromMrkdwn` from `src/round/speakable.ts`.
- Produces (used by Task 8):
  - `SENTENCE_END: string` (`'.?!;…'`)
  - `MAX_PENDING_CHARS: number` (200)
  - `interface SentenceState { pending: string }`
  - `emptySentences(): SentenceState`
  - `pushText(state: SentenceState, text: string): { state: SentenceState; sentences: string[] }`
  - `flushPending(state: SentenceState): string`

- [ ] **Step 1: Write the failing test**

Create `src/round/__tests__/sentences.test.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { emptySentences, flushPending, MAX_PENDING_CHARS, pushText, SENTENCE_END } from '../sentences';

/** Feed deltas in order, collecting every sentence emitted along the way. */
function feed(...deltas: string[]): { sentences: string[]; tail: string } {
  let state = emptySentences();
  const sentences: string[] = [];
  for (const d of deltas) {
    const r = pushText(state, d);
    state = r.state;
    sentences.push(...r.sentences);
  }
  return { sentences, tail: flushPending(state) };
}

describe('SENTENCE_END', () => {
  // Must equal Kokoro's kEndOfSentenceCharacters (Constants.h) so every push
  // lands on a boundary its native partitioner accepts immediately.
  it("matches Kokoro's end-of-sentence set", () => {
    for (const ch of ['.', '?', '!', ';', '…']) expect(SENTENCE_END).toContain(ch);
  });
});

describe('pushText', () => {
  it('emits a sentence once its terminator is followed by more text', () => {
    expect(feed('Hello there. How are you?', ' Fine.').sentences).toEqual([
      'Hello there.',
      'How are you?',
    ]);
  });

  it('holds a terminator that is still the last character', () => {
    // More could follow ("Hello." vs "Hello..."), so it waits.
    const { sentences, tail } = feed('Hello.');
    expect(sentences).toEqual([]);
    expect(tail).toBe('Hello.');
  });

  it('reassembles a sentence split across deltas', () => {
    expect(feed('Hello ther', 'e. Next').sentences).toEqual(['Hello there.']);
  });

  it('flattens markdown that spans two deltas', () => {
    // The whole point of buffering: speakableFromMrkdwn cannot unwrap half a
    // bold span, so flattening happens only once a sentence is complete.
    expect(feed('This is **rea', 'lly** important. Next').sentences).toEqual([
      'This is really important.',
    ]);
  });

  it('speaks a markdown link label and drops its url', () => {
    expect(feed('See [the doc](https://example.com/x). Next').sentences).toEqual(['See the doc.']);
  });

  it('does not split a decimal number', () => {
    expect(feed('It costs 3.50 dollars. Okay').sentences).toEqual(['It costs 3.50 dollars.']);
  });

  it('splits on every terminator in the set', () => {
    expect(feed('One. Two? Three! Four; End').sentences).toEqual(['One.', 'Two?', 'Three!', 'Four;']);
  });

  it('force-flushes at a word boundary once pending grows too long', () => {
    const long = 'word '.repeat(60); // 300 chars, no terminator
    const { sentences } = feed(long);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences[0].length).toBeLessThanOrEqual(MAX_PENDING_CHARS);
    expect(sentences[0].endsWith('word')).toBe(true);
  });

  it('keeps holding a single enormous unbroken token', () => {
    // No space to cut at; emitting a fragment mid-word would be worse.
    expect(feed('x'.repeat(MAX_PENDING_CHARS + 50)).sentences).toEqual([]);
  });

  it('emits nothing for whitespace-only input', () => {
    expect(feed('   ', '\n\n').sentences).toEqual([]);
  });

  it('does not mutate the state passed to it', () => {
    const before = emptySentences();
    pushText(before, 'Hello. ');
    expect(before.pending).toBe('');
  });
});

describe('flushPending', () => {
  it('returns the flattened remainder', () => {
    let state = emptySentences();
    state = pushText(state, 'Done. And **one** more thing').state;
    expect(flushPending(state)).toBe('And one more thing');
  });

  it('is empty when nothing is pending', () => {
    expect(flushPending(emptySentences())).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/round/__tests__/sentences.test.ts`
Expected: FAIL — "Cannot find module '../sentences'".

- [ ] **Step 3: Write minimal implementation**

Create `src/round/sentences.ts`:

```typescript
// Incremental sentence assembly for streamed replies — no React, no I/O,
// unit-tested.
//
// This exists for the *sanitizer*, not for Kokoro. Kokoro partitions its own
// input on sentence boundaries natively, so it would happily accept raw token
// deltas — but speakableFromMrkdwn cannot flatten half a `**bold**` span, and
// feeding it fragments would leak asterisks and urls into the spoken audio. So
// text accumulates here until a sentence is complete, gets flattened once, and
// only then goes to the engine.
//
// Splitting on Kokoro's own terminator set is a second, quieter benefit: every
// push ends on a boundary its partitioner accepts immediately, so its
// mid-sentence fallback (kStreamMaxSkippedIterations, ~600ms) never fires.

import { speakableFromMrkdwn } from './speakable';

/** Kokoro's kEndOfSentenceCharacters (Constants.h) — keep in sync. */
export const SENTENCE_END = '.?!;…';

/**
 * Past this much unterminated text, speak it anyway at the last word boundary.
 * A model that forgets punctuation must not be able to stall the audio.
 */
export const MAX_PENDING_CHARS = 200;

export interface SentenceState {
  /** Text received but not yet emitted as a complete sentence. */
  pending: string;
}

export function emptySentences(): SentenceState {
  return { pending: '' };
}

/**
 * Index just past the first sentence terminator that is followed by
 * whitespace, or -1. Requiring following whitespace is what keeps decimals
 * ("3.50") and a terminator still at the end of the buffer intact — the latter
 * because more input could still extend it ("Hello." → "Hello...").
 */
function splitIndex(text: string): number {
  for (let i = 0; i < text.length - 1; i++) {
    if (!SENTENCE_END.includes(text[i])) continue;
    if (/\s/.test(text[i + 1])) return i + 1;
  }
  return -1;
}

export function pushText(state: SentenceState, text: string): { state: SentenceState; sentences: string[] } {
  let pending = state.pending + text;
  const sentences: string[] = [];

  for (;;) {
    let cut = splitIndex(pending);
    if (cut < 0) {
      if (pending.length <= MAX_PENDING_CHARS) break;
      cut = pending.lastIndexOf(' ', MAX_PENDING_CHARS);
      if (cut <= 0) break; // one unbroken token; a mid-word fragment is worse
    }
    const speakable = speakableFromMrkdwn(pending.slice(0, cut));
    pending = pending.slice(cut);
    if (speakable) sentences.push(speakable);
  }

  return { state: { pending }, sentences };
}

/** Whatever is left when the stream ends, flattened. May be empty. */
export function flushPending(state: SentenceState): string {
  return speakableFromMrkdwn(state.pending);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/round/__tests__/sentences.test.ts` — Expected: PASS, 14 tests.
Run: `npm test` — Expected: all suites pass (no existing behavior touched).
Run: `npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/round/sentences.ts src/round/__tests__/sentences.test.ts
git commit -m "feat: incremental sentence buffer for streamed replies

Accumulates streamed text and emits complete, markdown-flattened
sentences. This exists for the sanitizer rather than for Kokoro -- Kokoro
partitions natively, but speakableFromMrkdwn cannot unwrap half a bold
span, so flattening has to happen at sentence boundaries.

Splits on Kokoro's own terminator set, so every push lands on a boundary
its partitioner takes immediately and its ~600ms mid-sentence fallback
never fires.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Delay the aside opener

**Files:**
- Modify: `src/speech/asides.ts` (replace `openAside`, extend `AsideState`, extend `decideAside`)
- Modify: `src/speech/useEcho.ts:223-235` (the aside setup block inside `askEva`)
- Test: `src/speech/__tests__/asides.test.ts` (extend; existing `openAside` cases must be rewritten)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 8):
  - `ASIDE_OPENER_DELAY_MS: number` (1_500)
  - `interface AsideState { startedAt: number; lastAsideAt: number; pendingTool: string | null; lastPhrase: string | null; openerSpoken: boolean }`
  - `beginAside(now: number): AsideState` — **replaces `openAside`**, returns state only
  - `decideAside(now: number, state: AsideState, rand: number): { say: string | null; state: AsideState }` — unchanged signature, now also responsible for the opener
  - `noteTool(state: AsideState, label: string): AsideState` — unchanged

- [ ] **Step 1: Write the failing test**

In `src/speech/__tests__/asides.test.ts`, replace the import list and the `openAside` describe block with the following. Keep every other existing block as-is.

```typescript
import { describe, expect, it } from '@jest/globals';
import {
  ASIDE_INTERVAL_MS,
  ASIDE_OPENER_DELAY_MS,
  beginAside,
  decideAside,
  FILLERS,
  noteTool,
  OPENERS,
  TOOL_LINES,
} from '../asides';

const NOW = 1_000_000;

describe('beginAside', () => {
  it('speaks nothing on its own — the opener is now a decideAside decision', () => {
    const state = beginAside(NOW);
    expect(state.openerSpoken).toBe(false);
    expect(state.startedAt).toBe(NOW);
    expect(state.lastPhrase).toBeNull();
  });
});

describe('decideAside — the delayed opener', () => {
  it('stays silent before the grace period elapses', () => {
    const state = beginAside(NOW);
    expect(decideAside(NOW + ASIDE_OPENER_DELAY_MS - 1, state, 0).say).toBeNull();
  });

  it('speaks an opener once the grace period elapses', () => {
    const state = beginAside(NOW);
    const d = decideAside(NOW + ASIDE_OPENER_DELAY_MS, state, 0);
    expect(OPENERS).toContain(d.say);
    expect(d.state.openerSpoken).toBe(true);
  });

  it('narrates a pending tool instead of an opener when one is already known', () => {
    const state = noteTool(beginAside(NOW), 'terminal');
    const d = decideAside(NOW + ASIDE_OPENER_DELAY_MS, state, 0);
    expect(TOOL_LINES.terminal).toContain(d.say);
    expect(d.state.pendingTool).toBeNull();
  });

  it('speaks the opener only once', () => {
    const opened = decideAside(NOW + ASIDE_OPENER_DELAY_MS, beginAside(NOW), 0);
    expect(decideAside(NOW + ASIDE_OPENER_DELAY_MS + 1, opened.state, 0).say).toBeNull();
  });

  it('resumes the normal filler cadence after the opener', () => {
    const opened = decideAside(NOW + ASIDE_OPENER_DELAY_MS, beginAside(NOW), 0);
    const at = NOW + ASIDE_OPENER_DELAY_MS;
    expect(decideAside(at + ASIDE_INTERVAL_MS - 1, opened.state, 0).say).toBeNull();
    const filler = decideAside(at + ASIDE_INTERVAL_MS, opened.state, 0);
    expect(FILLERS).toContain(filler.say);
  });

  it('never repeats the opener as the first filler', () => {
    const opened = decideAside(NOW + ASIDE_OPENER_DELAY_MS, beginAside(NOW), 0);
    const at = NOW + ASIDE_OPENER_DELAY_MS;
    for (let r = 0; r < 10; r++) {
      const filler = decideAside(at + ASIDE_INTERVAL_MS, opened.state, r / 10);
      expect(filler.say).not.toBe(opened.say);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/speech/__tests__/asides.test.ts`
Expected: FAIL — `beginAside` and `ASIDE_OPENER_DELAY_MS` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/speech/asides.ts`, replace the `AsideState` interface and `openAside`, and rewrite `decideAside`:

```typescript
/**
 * How long a wait has to last before an aside is worth speaking. The local
 * agent loop answers in well under a second; an opener fired immediately would
 * talk over the reply and delay it. This also fixes the same wart on the Slack
 * path, where the opener fired even when Eva happened to answer quickly.
 */
export const ASIDE_OPENER_DELAY_MS = 1_500;

export interface AsideState {
  /** Round start — the clock the opener's grace period is measured against. */
  startedAt: number;
  lastAsideAt: number;
  pendingTool: string | null;
  lastPhrase: string | null;
  openerSpoken: boolean;
}

/** Round entry. Speaks nothing: the opener is decideAside's first decision. */
export function beginAside(now: number): AsideState {
  return { startedAt: now, lastAsideAt: now, pendingTool: null, lastPhrase: null, openerSpoken: false };
}

/** Called on a coarse tick; returns a line only when one is due. */
export function decideAside(
  now: number,
  state: AsideState,
  rand: number,
): { say: string | null; state: AsideState } {
  if (!state.openerSpoken) {
    if (now - state.startedAt < ASIDE_OPENER_DELAY_MS) return { say: null, state };
    // A tool we already know about is more informative than a generic opener.
    const pool = state.pendingTool !== null ? (TOOL_LINES[state.pendingTool] ?? TOOL_LINES.default) : OPENERS;
    const say = pickPhrase(pool, null, rand);
    return { say, state: { ...state, lastAsideAt: now, pendingTool: null, lastPhrase: say, openerSpoken: true } };
  }
  if (now - state.lastAsideAt < ASIDE_INTERVAL_MS) return { say: null, state };
  const pool = state.pendingTool !== null ? (TOOL_LINES[state.pendingTool] ?? TOOL_LINES.default) : FILLERS;
  const say = pickPhrase(pool, state.lastPhrase, rand);
  return { say, state: { ...state, lastAsideAt: now, pendingTool: null, lastPhrase: say } };
}
```

Delete the now-unused `openAside` export. Leave `noteTool`, `pickPhrase`, and the
three phrase pools exactly as they are.

- [ ] **Step 4: Update the useEcho call site**

In `src/speech/useEcho.ts`, change the import at line 5 and the aside setup block inside `askEva` (currently lines 223-235):

```typescript
// line 5
import { beginAside, decideAside, noteTool, type AsideState } from './asides';
```

```typescript
      if (handlers.current.asides) {
        asideState.current = beginAside(Date.now());
        // Coarse 1s tick; decideAside owns the real cadence, including whether
        // the wait has lasted long enough to deserve an opener at all. The
        // interval (not a chained timeout) keeps ticking across long Kokoro
        // syntheses.
        asideTimer.current = setInterval(() => {
          if (!asideState.current) return;
          const d = decideAside(Date.now(), asideState.current, Math.random());
          asideState.current = d.state;
          if (d.say) speakAside(d.say);
        }, 1_000);
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/speech/__tests__/asides.test.ts` — Expected: PASS.
Run: `npm test` — Expected: all suites pass.
Run: `npx tsc --noEmit` — Expected: exit 0. If it reports `openAside` is still imported anywhere, remove that import.

- [ ] **Step 6: Commit**

```bash
git add src/speech/asides.ts src/speech/useEcho.ts src/speech/__tests__/asides.test.ts
git commit -m "feat: delay the aside opener behind a grace period

Streaming replies start speaking in well under a second, so an opener
fired at round entry would talk over the answer and delay it. The opener
becomes a decideAside decision gated on ASIDE_OPENER_DELAY_MS, which
collapses two entry points into one and also stops the opener firing on
Slack rounds that happen to answer quickly.

A tool echo already seen wins over a generic opener.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Streaming chat request

**Files:**
- Modify: `src/agent/openai.ts` (add `chatStream` and a shared error helper)

**Interfaces:**
- Consumes: `emptySse`, `parseSse` from Task 1.
- Produces (used by Task 7):
  - `interface ChatStreamOptions extends ChatOptions { onDelta: (text: string) => void }`
  - `chatStream(options: ChatStreamOptions): Promise<ChatReply>` — resolves with the assembled reply; `toolCalls` is always `[]`.

- [ ] **Step 1: Add the implementation**

Append to `src/agent/openai.ts` (and add the `sse` import at the top):

```typescript
import { emptySse, parseSse } from './sse';
```

```typescript
export interface ChatStreamOptions extends ChatOptions {
  /** Called with each content delta as it arrives, in order. */
  onDelta: (text: string) => void;
}

/**
 * Streaming counterpart to `chat`, on XMLHttpRequest rather than fetch —
 * React Native's fetch cannot stream a response body.
 *
 * Tool calls are NOT supported here: their arguments arrive fragmented across
 * frames and would need reassembly. `toolCalls` is always empty, and the caller
 * is responsible for using non-streaming `chat` whenever tools are offered
 * (see the guard in useAgent).
 */
export function chatStream({
  apiKey,
  model,
  messages,
  signal,
  maxTokens,
  temperature,
  onDelta,
}: ChatStreamOptions): Promise<ChatReply> {
  return new Promise<ChatReply>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sse = emptySse();
    let consumed = 0;
    let text = '';
    let usage: ChatUsage | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // responseText accumulates, so only ever read the new tail.
    const read = () => {
      const whole = xhr.responseText;
      if (whole.length <= consumed) return;
      const incoming = whole.slice(consumed);
      consumed = whole.length;
      const r = parseSse(sse, incoming);
      sse = r.state;
      if (r.chunk.usage) usage = r.chunk.usage;
      for (const delta of r.chunk.deltas) {
        text += delta;
        onDelta(delta);
      }
    };

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', `${BASE}/chat/completions`);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.setRequestHeader('Accept', 'text/event-stream');

    // MUST be assigned before send(): RN decides whether to deliver the body
    // incrementally by checking whether onprogress is already set. Assign it
    // afterwards and the whole response arrives in one lump.
    xhr.onprogress = read;
    xhr.onload = () => {
      read();
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(new Error(streamErrorMessage(xhr.responseText, xhr.status))));
        return;
      }
      finish(() =>
        resolve({
          text: text.trim(),
          toolCalls: [],
          usage,
          message: { role: 'assistant', content: text },
        }),
      );
    };
    xhr.onerror = () => {
      cleanup();
      finish(() => reject(new Error('network error')));
    };
    xhr.onabort = () => {
      cleanup();
      finish(() => reject(new Error('aborted')));
    };

    xhr.send(
      JSON.stringify({
        model,
        messages,
        stream: true,
        // Without this a streamed response carries no usage at all, and the
        // per-round token line silently goes blank.
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    );
  });
}

/** An error body on the streaming path is ordinary JSON, not an SSE frame. */
function streamErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed?.error?.message) return `${parsed.error.message} (http ${status})`;
  } catch {
    // fall through to the bare status
  }
  return `http ${status}`;
}
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npm test` — Expected: all suites pass (this task adds no behavior anyone calls yet).

There is deliberately no unit test for the XHR wiring: the repo has no precedent for mocking native networking, and the part with real edge cases (frame parsing) is already covered by Task 1. It is exercised on device in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/agent/openai.ts
git commit -m "feat: streaming chat request over XMLHttpRequest

RN's fetch cannot stream a response body, so the SSE path rides XHR.
Two platform details are load-bearing: onprogress must be assigned before
send() or RN delivers the body in one lump, and responseText accumulates
so the reader tracks a consumed offset.

Sends stream_options.include_usage, without which streamed responses
carry no usage and the per-round token line goes blank. Tool calls are
not supported on this path -- their arguments arrive fragmented -- so
toolCalls is always empty and the caller must use chat() when tools are
offered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Kokoro streaming primitive

**Files:**
- Modify: `src/speech/kokoro.ts` (add `speakStreamWithKokoro`, re-express `speakWithKokoro`, change `runStream`)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 6):
  - `interface KokoroStream { push(text: string): void; end(): void }`
  - `speakStreamWithKokoro(handlers: KokoroSpeakHandlers): KokoroStream`
  - `speakWithKokoro(text: string, handlers: KokoroSpeakHandlers): void` — unchanged signature, now a wrapper

- [ ] **Step 1: Replace `speakWithKokoro` and `runStream`**

In `src/speech/kokoro.ts`, replace both functions (currently lines 105-174) with:

```typescript
export interface KokoroStream {
  /** Append text to synthesize. Ignored after end() or a stop. */
  push(text: string): void;
  /** No more text coming: drain the buffer and finish. */
  end(): void;
}

/**
 * Open a streaming utterance. Text pushed in arrives as one continuous piece of
 * audio, so synthesis of later sentences overlaps playback of earlier ones.
 *
 * Runs the native stream with `stopAutomatically: false`, because the default
 * exits the loop the moment the buffer empties (Kokoro.cpp:193) — which for an
 * incrementally-fed stream means dying in the gap between two sentences.
 * `streamStop(false)` is the counterpart: it sets stopOnEmptyBuffer, i.e.
 * "no more input, drain what you have and exit".
 */
export function speakStreamWithKokoro(handlers: KokoroSpeakHandlers): KokoroStream {
  const e = engine;
  if (!e || status.state !== 'ready') {
    handlers.onError(new Error('kokoro engine is not ready'), false);
    return { push: () => {}, end: () => {} };
  }

  const s: ActiveSpeech = { stopped: false, audioStarted: false, sink: null };
  current = s;

  // Pushes can arrive before the previous stream has wound down (see the wait
  // below); hold them until the native stream is actually live.
  let live = false;
  let ended = false;
  const queued: string[] = [];

  const insert = (text: string) => {
    // Kokoro partitions on terminal punctuation; callers send whole sentences,
    // but a tail without one would otherwise sit in the buffer until the
    // partitioner's skip fallback, so terminate it here.
    e.streamInsert('.?!;…'.includes(text.slice(-1)) ? text : `${text}.`);
  };

  const prev = streamTail;
  streamTail = (async () => {
    // A barge-in stops the previous stream via streamStop(true), but the
    // native side lands that asynchronously — starting the next stream in the
    // same tick can get it killed or corrupted. Wait for the previous
    // generator to actually exit, but never indefinitely: a hung stream must
    // not take future utterances down with it.
    await Promise.race([prev, new Promise((r) => setTimeout(r, 2000))]);
    if (s.stopped) return;
    await runStream(e, s, handlers, () => {
      live = true;
      for (const text of queued.splice(0)) insert(text);
      if (ended) e.streamStop(false);
    });
  })();

  return {
    push: (text) => {
      const trimmed = text.trim();
      if (s.stopped || ended || !trimmed) return;
      if (!live) {
        queued.push(trimmed);
        return;
      }
      insert(trimmed);
    },
    end: () => {
      if (s.stopped || ended) return;
      ended = true;
      // Before the stream is live, onLive will issue this once it starts.
      if (live) e.streamStop(false);
    },
  };
}

/** One-shot speech, expressed as a stream of exactly one push. */
export function speakWithKokoro(text: string, handlers: KokoroSpeakHandlers): void {
  if (!text.trim()) {
    handlers.onDone();
    return;
  }
  const stream = speakStreamWithKokoro(handlers);
  stream.push(text);
  stream.end();
}

async function runStream(
  e: TextToSpeechModule,
  s: ActiveSpeech,
  handlers: KokoroSpeakHandlers,
  onLive: () => void,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const audioOut = require('./audioOut') as typeof import('./audioOut');
  try {
    s.sink = audioOut.beginUtterance({
      onFirstAudio: () => {
        if (s.stopped) return;
        s.audioStarted = true;
        handlers.onStart();
      },
      onDrained: () => {
        if (s.stopped) return;
        s.stopped = true;
        if (current === s) current = null;
        handlers.onDone();
      },
    });
    onLive();
    // stopAutomatically: false — the loop must survive the gaps between
    // sentences; end() closes it via streamStop(false).
    for await (const chunk of e.stream({ speed: 1.0, phonemize: true, stopAutomatically: false })) {
      if (s.stopped) return;
      s.sink.enqueue(chunk);
    }
    if (!s.stopped) s.sink.finishInput();
  } catch (error) {
    if (s.stopped) return;
    s.stopped = true;
    if (current === s) current = null;
    try {
      // An audio-side throw leaves the native stream running; without this the
      // next utterance's streamInsert lands on the abandoned stream.
      e.streamStop(true);
    } catch {
      // stopping an idle stream is harmless
    }
    s.sink?.stop();
    handlers.onError(error, s.audioStarted);
  }
}
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npm test` — Expected: all suites pass. `tts.test.ts` mocks `../kokoro` and does not reference `speakStreamWithKokoro` yet, so it is unaffected until Task 6.

There is no unit test here: `kokoro.ts` lazy-`require`s two native modules and has never been unit-tested. Verified on device in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/speech/kokoro.ts
git commit -m "feat: incremental Kokoro streaming

speakStreamWithKokoro feeds one long-lived native stream, so synthesis of
later sentences overlaps playback of earlier ones with no gap between
them. speakWithKokoro becomes a wrapper over it -- one push, then end --
so there is a single streaming implementation.

Uses stopAutomatically: false, because the default exits the native loop
as soon as the buffer empties (Kokoro.cpp:193), which for an
incrementally-fed stream means dying in the gap between two sentences.
streamStop(false) is the counterpart: drain what is buffered, then exit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Streaming TTS facade

**Files:**
- Modify: `src/speech/tts.ts` (add `speakStream`)
- Test: `src/speech/__tests__/tts.test.ts` (extend; the `../kokoro` mock needs the new export)

**Interfaces:**
- Consumes: `speakStreamWithKokoro`, `KokoroStream` from Task 5.
- Produces (used by Task 8):
  - `interface SpeechStream { push(text: string): void; end(): void }`
  - `speakStream(cb?: SpeakCallbacks): SpeechStream`

- [ ] **Step 1: Write the failing test**

In `src/speech/__tests__/tts.test.ts`, extend the `mockKokoro` object and its `jest.mock('../kokoro', …)` factory, then add the new describe block.

Add to `mockKokoro` (alongside the existing fields):

```typescript
  streamPushes: [] as string[],
  streamEnded: false,
```

Add to the `jest.mock('../kokoro', …)` factory return object:

```typescript
  speakStreamWithKokoro: (handlers: unknown) => {
    mockKokoro.handlers = handlers as typeof mockKokoro.handlers;
    return {
      push: (text: string) => mockKokoro.streamPushes.push(text),
      end: () => {
        mockKokoro.streamEnded = true;
      },
    };
  },
```

Add the import of `speakStream` to the existing import from `../tts`, then append:

```typescript
describe('speakStream', () => {
  beforeEach(() => {
    mockKokoro.streamPushes = [];
    mockKokoro.streamEnded = false;
    mockKokoro.handlers = null;
    mockKokoro.state = 'ready';
    mockSpeech.speak.mockClear();
    mockSpeech.current = null;
  });

  it('forwards each push to the Kokoro stream', () => {
    const stream = speakStream();
    stream.push('Hello there.');
    stream.push('How are you?');
    expect(mockKokoro.streamPushes).toEqual(['Hello there.', 'How are you?']);
  });

  it('closes the Kokoro stream on end', () => {
    speakStream().end();
    expect(mockKokoro.streamEnded).toBe(true);
  });

  it('reports start on first audio and done on drain', () => {
    const onStart = jest.fn();
    const onDone = jest.fn();
    const stream = speakStream({ onStart, onDone });
    stream.push('Hi.');
    mockKokoro.handlers?.onStart();
    expect(onStart).toHaveBeenCalledTimes(1);
    mockKokoro.handlers?.onDone();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reports done exactly once even if drain is reported twice', () => {
    const onDone = jest.fn();
    speakStream({ onDone }).push('Hi.');
    mockKokoro.handlers?.onDone();
    mockKokoro.handlers?.onDone();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('speaks nothing until end when Kokoro is unavailable', async () => {
    mockKokoro.state = 'unavailable';
    const stream = speakStream();
    stream.push('Hello there.');
    stream.push(' How are you?');
    expect(mockSpeech.speak).not.toHaveBeenCalled();
    stream.end();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    expect(mockSpeech.speak.mock.calls[0][0]).toBe('Hello there. How are you?');
  });

  it('replays the whole text on the system voice when Kokoro fails before any audio', async () => {
    const stream = speakStream();
    stream.push('Hello there.');
    mockKokoro.handlers?.onError(new Error('nope'), false);
    stream.push(' And more.');
    stream.end();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    expect(mockSpeech.speak.mock.calls[0][0]).toBe('Hello there. And more.');
  });

  it('reports an error rather than falling back once audio has started', () => {
    const onError = jest.fn();
    const stream = speakStream({ onError });
    stream.push('Hello.');
    mockKokoro.handlers?.onError(new Error('mid-audio'), true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockSpeech.speak).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/speech/__tests__/tts.test.ts`
Expected: FAIL — `speakStream` is not exported from `../tts`.

- [ ] **Step 3: Write minimal implementation**

In `src/speech/tts.ts`, change the kokoro import and append `speakStream`:

```typescript
import { getTtsStatus, initKokoro, speakStreamWithKokoro, speakWithKokoro, stopKokoro } from './kokoro';
```

```typescript
export interface SpeechStream {
  /** Append text to speak. Safe to call repeatedly as a reply arrives. */
  push(text: string): void;
  /** No more text coming. */
  end(): void;
}

/**
 * Speak text that is still arriving. Kokoro streams it as one continuous
 * utterance; the system voice, which has no streaming API, accumulates and
 * speaks the whole thing on end() — exactly today's behavior and latency.
 */
export function speakStream(cb: SpeakCallbacks = {}): SpeechStream {
  stopSpeaking();
  const u: Utterance = { id: ++seq, text: '', cb, settled: false };
  active = u;
  const status = getTtsStatus();
  // A failed first-run download would otherwise demote the appliance to the
  // system voice until relaunch; retrying here gives a natural backoff.
  if (status.state === 'error') void initKokoro();

  if (status.state !== 'ready') {
    let ended = false;
    return {
      push: (text) => {
        if (!ended) u.text += text;
      },
      end: () => {
        if (ended) return;
        ended = true;
        void speakSystem(u);
      },
    };
  }

  if (__DEV__) console.log('[tts] streaming (kokoro)');
  let fellBack = false;
  let ended = false;
  const stream = speakStreamWithKokoro({
    onStart: () => {
      if (isCurrent(u)) cb.onStart?.();
    },
    onDone: () => settleUtterance(u, () => cb.onDone?.()),
    onError: (e, audioStarted) => {
      if (u.settled) return;
      if (audioStarted) {
        settleUtterance(u, () => cb.onError?.(e));
        return;
      }
      // Nothing audible yet — the system voice can still speak the whole
      // reply. u.text has been accumulating for exactly this case.
      if (__DEV__) console.log('[tts] kokoro failed pre-audio, falling back:', e);
      fellBack = true;
      if (ended) void speakSystem(u);
    },
  });

  return {
    push: (text) => {
      if (ended) return;
      u.text += text;
      if (!fellBack) stream.push(text);
    },
    end: () => {
      if (ended) return;
      ended = true;
      if (fellBack) void speakSystem(u);
      else stream.end();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/speech/__tests__/tts.test.ts` — Expected: PASS, including the 7 new cases.
Run: `npm test` — Expected: all suites pass.
Run: `npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/speech/tts.ts src/speech/__tests__/tts.test.ts
git commit -m "feat: speakStream facade over both TTS engines

Kokoro streams text as one continuous utterance; the system voice, which
has no streaming API, accumulates and speaks the whole thing on end() --
today's behavior and today's latency, which is the honest degradation for
Expo Go and the simulator.

The pre-audio Kokoro fallback survives streaming: accumulated text is
retained, so a failure before first audio still gets spoken in full by
the system voice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Widen the ask contract and stream from useAgent

**Files:**
- Modify: `src/round/ask.ts` (add `AskOptions`)
- Modify: `src/agent/useAgent.ts` (route to `chatStream`; record partial replies)
- Modify: `src/speech/useEcho.ts:33` (widen the `ask` handler type only)

**Interfaces:**
- Consumes: `chatStream` from Task 4.
- Produces (used by Task 8):
  - `interface AskOptions { onDelta?: (text: string) => void }` in `src/round/ask.ts`
  - `ask(text: string, opts?: AskOptions): Promise<AskResult>` on the value returned by `useAgent`

- [ ] **Step 1: Add `AskOptions`**

In `src/round/ask.ts`, add:

```typescript
/**
 * Per-round options a transport may honour. A transport that cannot stream
 * simply never calls `onDelta`, which is what lets useEcho decide how to
 * deliver the reply without asking the transport what it supports.
 */
export interface AskOptions {
  /** Called with each fragment of the reply as it arrives, in order. */
  onDelta?: (text: string) => void;
}
```

- [ ] **Step 2: Widen the handler type in useEcho**

In `src/speech/useEcho.ts`, change the import on line 3 and the `ask` field:

```typescript
import { type AskOptions, type AskResult, formatLatency } from '../round/ask';
```

```typescript
  /**
   * Route captured speech to Eva and speak her reply. When absent (unpaired
   * device, no API key, Expo Go), rounds fall back to the Phase-1 echo.
   */
  ask?: (text: string, opts?: AskOptions) => Promise<AskResult>;
```

- [ ] **Step 3: Stream from useAgent**

In `src/agent/useAgent.ts`, add the imports and replace the body of `ask`'s try block. Imports:

```typescript
import type { AskOptions, AskResult } from '../round/ask';
import { chat, chatStream, type ChatUsage, formatUsage, type RequestMessage, type ToolCall, type ToolMessage, type ToolSpec } from './openai';
```

Replace the `ask` callback with:

```typescript
  const ask = useCallback(
    async (text: string, opts?: AskOptions): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I don't have a brain configured right now." };

      const postedAt = Date.now();
      const asked = appendTurn(session.current ?? newSession(postedAt), { role: 'user', content: text }, postedAt);
      session.current = asked;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
      let usage: ChatUsage | null = null;
      // Text handed to the speaker so far. On a mid-stream failure this is
      // what Eva actually said, so it is what goes into history.
      let streamed = '';

      try {
        const messages: RequestMessage[] = buildRequest(PERSONA, memories.current, asked);
        let raw = '';

        // Streaming cannot reassemble fragmented tool_call arguments, so a
        // request that offers tools must use the non-streaming loop. Guarding
        // on TOOLS means defining one can't silently break streaming.
        if (opts?.onDelta && TOOLS.length === 0) {
          const res = await chatStream({
            apiKey: cfg.apiKey,
            model: cfg.model,
            messages,
            signal: controller.signal,
            maxTokens: MAX_REPLY_TOKENS,
            onDelta: (delta) => {
              streamed += delta;
              opts.onDelta?.(delta);
            },
          });
          usage = res.usage;
          raw = res.text;
        } else {
          for (let step = 0; step < MAX_STEPS; step++) {
            const res = await chat({
              apiKey: cfg.apiKey,
              model: cfg.model,
              messages,
              tools: TOOLS,
              signal: controller.signal,
              maxTokens: MAX_REPLY_TOKENS,
            });
            // Usage is per-call; the last one is the round's headline number.
            usage = res.usage ?? usage;
            if (!res.toolCalls.length) {
              raw = res.text;
              break;
            }
            messages.push(res.message);
            for (const call of res.toolCalls) messages.push(await runTool(call));
          }
        }

        const replyAt = Date.now();
        if (usage) callbacks.current.onUsage?.(`agent · ${formatUsage(usage)}`);
        if (!raw) return { kind: 'error', message: 'agent · empty reply' };

        session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: raw }, replyAt);
        await saveSession(session.current);
        // After the answer is on its way to the speaker, never before it.
        void compact();

        return { kind: 'reply', raw, speakable: speakableFromMrkdwn(raw), postedAt, replyAt };
      } catch (e) {
        if (streamed) {
          // Part of the reply is already audible. Record what was said so the
          // conversation stays coherent, and let the spoken part stand.
          session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: streamed }, Date.now());
          await saveSession(session.current);
          return { kind: 'error', message: 'agent · stream failed mid-reply' };
        }
        if (controller.signal.aborted) return { kind: 'timeout', postedAt };
        return { kind: 'error', message: `agent · ${e instanceof Error ? e.message : String(e)}` };
      } finally {
        clearTimeout(timer);
      }
    },
    [compact],
  );
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npx tsc --noEmit` — Expected: exit 0. `FaceScreen`'s Slack lambda still typechecks: a function taking fewer parameters satisfies a wider signature.
Run: `npm test` — Expected: all suites pass. Nothing passes `onDelta` yet, so behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/round/ask.ts src/agent/useAgent.ts src/speech/useEcho.ts
git commit -m "feat: stream replies from useAgent when a delta sink is given

ask() gains an optional onDelta. Transports that cannot stream never call
it, which is what lets useEcho pick a delivery path without interrogating
the transport. Slack needs no change.

Streaming is skipped whenever tools are offered, since fragmented
tool_call arguments would need reassembly the streaming path does not do.

A mid-stream failure records the text actually spoken into history, so the
conversation stays coherent about what Eva said.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Speak the reply as it streams

**Files:**
- Modify: `src/speech/useEcho.ts` (extract `finishSpoken`; stream in `askEva`)

**Interfaces:**
- Consumes: `speakStream`/`SpeechStream` (Task 6), `pushText`/`flushPending`/`emptySentences`/`SentenceState` (Task 2), `AskOptions` (Task 7).
- Produces: no new exports; `useEcho`'s returned shape is unchanged.

- [ ] **Step 1: Add imports and refs**

In `src/speech/useEcho.ts`, add:

```typescript
import { emptySentences, flushPending, pushText, type SentenceState } from '../round/sentences';
import { speak, speakStream, stopSpeaking, type SpeechStream } from './tts';
```

Inside the hook, alongside the existing refs:

```typescript
  // Streaming delivery. Non-null once the first delta of a round has arrived,
  // which is also the signal that this round is being spoken incrementally
  // rather than as one finished utterance.
  const speech = useRef<SpeechStream | null>(null);
  const sentences = useRef<SentenceState>(emptySentences());
  /** Text actually handed to the speaker, for onSaid on a failed stream. */
  const spoken = useRef('');
```

- [ ] **Step 2: Extract `finishSpoken` from `deliver`**

Add this callback above `deliver`, and replace `deliver`'s `onDone` body with a call to it. This is the settle-or-follow-up decision, which both delivery paths now need.

```typescript
  /**
   * A reply finished playing. Either open the follow-up window and re-arm the
   * mic, or settle the face. Shared by the whole-utterance and streaming paths.
   */
  const finishSpoken = useCallback(
    (round: number, via: 'pleased' | 'confused') => {
      if (round !== epoch.current) return;
      if (via === 'pleased' && voiceRound.current && handlers.current.conversation) {
        // Follow-up window: pleased beat doubles as the "your turn" cue,
        // then re-open the mic instead of settling to idle.
        convWindow.current = decideNext('reply-delivered', Date.now(), convWindow.current).window;
        setMode('pleased');
        after(PLEASED_BEAT_MS, () => void openMic());
      } else {
        settle(via, via === 'pleased' ? PLEASED_BEAT_MS : CONFUSED_BEAT_MS);
      }
    },
    [after, openMic, setMode, settle],
  );
```

In `deliver`, replace the `onDone` handler with:

```typescript
        onDone: () => finishSpoken(round, via),
```

and add `finishSpoken` to `deliver`'s dependency array, removing `openMic` and `after` if they become unused there.

- [ ] **Step 3: Clear stream state on every epoch bump**

Extend `clearAsides` into a combined reset so no call site can forget one. Rename
it and update **every** call site — `openMic`, the `askEva` entry, the pre-deliver
clear inside `askEva`, the `askEva` finally block, `announce`, `cancel`, and the
unmount effect. `grep -n clearAsides src/speech/useEcho.ts` must return nothing
when this step is done.

```typescript
  /** Drop both cosmetic asides and any open streaming utterance. */
  const clearRoundSpeech = useCallback(() => {
    if (asideTimer.current) clearInterval(asideTimer.current);
    asideTimer.current = null;
    asideState.current = null;
    speech.current = null;
    sentences.current = emptySentences();
    spoken.current = '';
  }, []);
```

Replace every `clearAsides()` call with `clearRoundSpeech()`. Note it does **not** call `stopSpeaking()` — the existing call sites that need audio stopped already do it themselves.

- [ ] **Step 4: Stream inside `askEva`**

Replace the body of `askEva` from `const round = ++epoch.current;` through the end of the `switch` with:

```typescript
      const round = ++epoch.current;
      clearRoundSpeech();
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      const postedAt = Date.now();
      let firstDeltaAt: number | undefined;

      if (handlers.current.asides) {
        asideState.current = beginAside(postedAt);
        // Coarse 1s tick; decideAside owns the real cadence, including whether
        // the wait has lasted long enough to deserve an opener at all.
        asideTimer.current = setInterval(() => {
          if (!asideState.current) return;
          const d = decideAside(Date.now(), asideState.current, Math.random());
          asideState.current = d.state;
          if (d.say) speakAside(d.say);
        }, 1_000);
      }

      /** First delta of the round: stop narrating and start speaking for real. */
      const openSpeech = () => {
        if (speech.current) return;
        firstDeltaAt = Date.now();
        // An aside must not talk over the reply, and its settling onDone must
        // not flip the mode back to thinking mid-answer.
        if (asideTimer.current) clearInterval(asideTimer.current);
        asideTimer.current = null;
        asideState.current = null;
        stopSpeaking();
        speech.current = speakStream({
          onStart: () => {
            if (round !== epoch.current) return;
            setMode('speaking');
            handlers.current.onLatency?.(
              formatLatency({ ...marks, postedAt, replyAt: firstDeltaAt, spokeAt: Date.now() }),
            );
          },
          onBoundary: () => {
            if (round === epoch.current) onPulse?.();
          },
          onDone: () => finishSpoken(round, 'pleased'),
          onError: () => finishSpoken(round, 'confused'),
        });
      };

      const onDelta = (delta: string) => {
        if (round !== epoch.current) return;
        openSpeech();
        const r = pushText(sentences.current, delta);
        sentences.current = r.state;
        for (const sentence of r.sentences) {
          spoken.current = spoken.current ? `${spoken.current} ${sentence}` : sentence;
          speech.current?.push(sentence);
        }
      };

      try {
        const result = await doAsk(text, { onDelta });
        if (round !== epoch.current) return; // cancelled or superseded mid-flight
        if (result.kind !== 'reply') {
          convWindow.current = decideNext('ask-failed', Date.now(), convWindow.current).window;
        }

        // Streaming path: the reply is already playing. Flush the tail, close
        // the stream, and let its drain callback settle the round.
        if (speech.current) {
          const tail = flushPending(sentences.current);
          if (tail) {
            spoken.current = spoken.current ? `${spoken.current} ${tail}` : tail;
            speech.current.push(tail);
          }
          speech.current.end();
          speech.current = null;
          onSaid?.(result.kind === 'reply' ? result.speakable : spoken.current);
          // A failure after audio started is a transcript line, never a spoken
          // apology over the top of a half-delivered answer.
          if (result.kind === 'error') onIssue?.(result.message);
          return;
        }

        // Nothing streamed (Slack, or a transport that resolved without deltas).
        clearRoundSpeech();
        switch (result.kind) {
          case 'reply': {
            const speakable = result.speakable || 'Eva replied with something I cannot say aloud.';
            deliver(speakable, 'pleased', () =>
              handlers.current.onLatency?.(
                formatLatency({ ...marks, postedAt: result.postedAt, replyAt: result.replyAt, spokeAt: Date.now() }),
              ),
            );
            break;
          }
          case 'timeout':
            handlers.current.onLatency?.(formatLatency({ ...marks, postedAt: result.postedAt }));
            deliver(result.message ?? TIMEOUT_LINE, 'confused');
            break;
          case 'offline':
            deliver(result.message ?? OFFLINE_LINE, 'confused');
            break;
          case 'error':
            stopSpeaking(); // a lingering or queued aside must not talk over the confused face
            onIssue?.(result.message); // transports prefix their own source
            settle('confused', CONFUSED_BEAT_MS);
            break;
        }
      } finally {
        // Safety net: an ask handler that rejects instead of resolving would
        // otherwise leak the interval and narrate fillers forever. The round
        // guard preserves the invariant that a superseded round never clears a
        // newer one's state. An open stream is left alone — its drain callback
        // still owes this round a settle.
        if (round === epoch.current && !speech.current) clearRoundSpeech();
      }
```

Update `askEva`'s dependency array to `[clearRoundSpeech, clearTimer, deliver, finishSpoken, onIssue, onPulse, onSaid, sayBack, setMode, settle, speakAside]`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npm test` — Expected: all suites pass.

Read back the two invariants by eye, since no test covers them:
1. Every path out of `askEva` either opens the follow-up window / settles the face, or leaves an open `speech.current` whose `onDone`/`onError` will. Wedging the face in `thinking` deafens the wake watcher.
2. `stopSpeaking()` is called before `speakStream()` in `openSpeech`, so a mid-flight aside cannot play over the reply.

- [ ] **Step 6: Commit**

```bash
git add src/speech/useEcho.ts
git commit -m "feat: speak streamed replies as they arrive

useEcho now opens a speech stream lazily on the first delta of a round,
pushes each complete flattened sentence, and lets the audio drain
callback settle the round. A transport that never sends a delta (Slack)
falls through to the existing whole-utterance path untouched.

The settle-or-follow-up decision moves into a shared finishSpoken, since
both delivery paths need it, and clearAsides becomes clearRoundSpeech so
an epoch bump cannot clear one kind of round speech but not the other.

Latency now reports time to first token as 'eva' and time to first audio
as 'total', which is what the round actually feels like.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Device verification and docs

**Files:**
- Modify: `CLAUDE.md` (streaming note in the agent/speech sections)
- Modify: `docs/superpowers/specs/2026-08-15-streaming-speech-design.md` (status line)
- Modify: `docs/superpowers/specs/2026-08-15-local-agent-loop-design.md` (the "Deliberately out of scope" entry for streaming TTS is now done)

- [ ] **Step 1: Full local verification**

```bash
npx tsc --noEmit && npm test
```
Expected: exit 0; all suites pass.

- [ ] **Step 2: Confirm the code reaches the bundle**

```bash
npx expo export --platform ios --output-dir /tmp/eva-stream-check 2>&1 | tail -5
```

Then check for the new code. **Note two traps:** Hermes puts any string containing non-ASCII (em-dashes, the `·` separator) in a UTF-16 table where plain `grep` will not find it, and zsh does not glob after parameter expansion — so resolve the path with `$(ls …)` and check both encodings:

```bash
B=$(ls /tmp/eva-stream-check/_expo/static/js/ios/*.hbc)
python3 - "$B" <<'PY'
import sys
data = open(sys.argv[1], 'rb').read()
for s in ['stream_options', 'text/event-stream', 'include_usage', 'streaming (kokoro)']:
    hit = s.encode() in data or s.encode('utf-16-le') in data
    print(f"  {'present' if hit else 'MISSING':<9} {s}")
PY
```
Expected: all four present.

- [ ] **Step 3: On-device verification**

With `EXPO_PUBLIC_OPENAI_API_KEY` set in `.env.local`, run `npx expo start` and open the app on the dedicated iPhone. Triple-tap top-left for the dev overlay, confirm `BRAIN · gpt-4o-mini`, and check each of these:

1. **Streaming works.** Ask "tell me about your day in five sentences". Eva must begin speaking well before the reply finishes generating, with **no audible gaps** between sentences.
2. **Time-to-first-audio is length-independent.** Compare the `latency` line for a one-sentence answer ("what's two plus two") against the five-sentence one. `total` should be similar for both; before this change it grew with length.
3. **Asides no longer fire on fast rounds.** A local round must produce no spoken opener.
4. **Asides still fire on slow rounds.** Switch **BRAIN** to `slack`, ask something, and confirm the opener arrives after ~1.5s and fillers follow every ~12s.
5. **Follow-ups still work.** After a streamed reply the mic must re-open (face goes `pleased`, then `listening`).
6. **Barge-in teardown.** Mid-reply, triple-tap and press **Listen**. Audio must stop and the mic must open — the `streamTail` 2s wait is the thing most likely to misbehave here.
7. **Fallback voice.** Nothing to do on device; the simulator exercises it, since Kokoro reports `unavailable` there. Confirm a reply still speaks whole.
8. **Token line intact.** The transcript must still show `agent · … in (… cached) · … out`. If `cached` is permanently absent, `stream_options.include_usage` did not reach the request.

- [ ] **Step 4: Update the docs**

In `docs/superpowers/specs/2026-08-15-streaming-speech-design.md`, change the status line to `Status: implemented.`

In `docs/superpowers/specs/2026-08-15-local-agent-loop-design.md`, under "Deliberately out of scope", replace the **Sentence-streaming TTS** bullet with:

```markdown
- **Sentence-streaming TTS** — done, see
  [2026-08-15-streaming-speech-design.md](2026-08-15-streaming-speech-design.md).
```

In `CLAUDE.md`, add to the local-agent bullet list:

```markdown
- Replies **stream**: `openai.chatStream` (XHR, since RN's fetch can't stream a body) → `sse.ts` → `sentences.ts` (flattens markdown at sentence boundaries, because `speakableFromMrkdwn` can't unwrap half a `**bold**` span) → `tts.speakStream` → one long-lived Kokoro stream. Kokoro must run with `stopAutomatically: false`; the default kills the stream in the gap between two sentences. The system voice can't stream and buffers to completion instead.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/
git commit -m "docs: record streaming speech as implemented

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the two pure modules → Tasks 1–2; the aside grace period → Task 3; `chatStream` and both XHR gotchas → Task 4; the Kokoro `stopAutomatically`/`streamStop` change and the `speakWithKokoro` unification → Task 5; the `tts.speakStream` facade and the preserved pre-audio fallback → Task 6; the `ask` contract widening, the streaming/tools guard, and the mid-stream-failure history record → Task 7; lazy stream opening, `finishSpoken`, epoch clearing, and the `onSaid` rule → Task 8; every listed on-device check → Task 9.

**Known gaps, deliberately left.** A code fence spanning two sentences can leak its backticks, since `speakableFromMrkdwn` needs both fences to strip a block — the persona forbids code blocks, and the flattener drops stray backticks as inline emphasis anyway. An abbreviation ("Dr. Smith") splits into two pushes, costing an inaudible extra pause. Neither is worth a guard.

**One safety net worth knowing about.** With `stopAutomatically: false`, a stream whose `end()` never runs would spin forever; `audioOut`'s existing watchdog (`audioOut.ts:71-81`) fires `onDrained` after the remaining audio plus 5s, so the face still settles. That is a backstop, not the design.
