# Local agent loop — design

Status: implemented.

## Problem

Eva's reasoning lives off-device. A spoken round posts `<@EVA> <utterance>` into
`#eva-direct` and waits for hermes-agent's reply over Socket Mode;
`ASK_TIMEOUT_MS` is **90 seconds**, and thinking asides (`src/speech/asides.ts`)
exist to fill an observed 10–90s wait with spoken filler. The wait *is* the
interaction experience.

Talk to a model directly and the reply comes back in about a second. That trade
costs us Eva's tools and her Slack presence, so both brains stay wired.

It also costs us conversation state: the Slack channel *was* the history. Owning
it is the second half of this change, and the seed of memory — the thing a later
exe.dev sync would carry between the phone and everywhere else.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Loop shape | Single-shot per turn, written as a `for (step)` loop over `tool_calls` | Tools become additive rather than a restructure. `TOOLS` is empty, so the loop never spins today. |
| Model | `gpt-4o-mini`, `EXPO_PUBLIC_OPENAI_MODEL` overrides | Cheaper per token than gpt-3.5-turbo, better at persona, and eligible for automatic prompt caching — which gpt-3.5-turbo is not. |
| API | Chat Completions, not Responses | Responses offers server-side conversation state, which would fight the local compaction and memory ownership that is the point. |
| Transport | Bare `fetch`, no SDK | Matches `src/slack/api.ts`; the surface used is one endpoint. |
| Slack | Kept, switchable from the dev overlay | Still the only route to Eva's real tools, and the only proactive-push source. Also the comparison baseline. |
| Compaction | Summarize-oldest above a token budget | Bounds a long desk-side day without making Eva forget how the conversation started. |
| Memory | Last 5 archived session summaries, injected | Nearly free once sessions are archived, and it's the actual experience win. |
| Storage | JSON files via expo-file-system | Already a declared dep (no EAS rebuild). Discrete files are the natural sync unit; AsyncStorage blobs are not. |
| Key storage | `EXPO_PUBLIC_OPENAI_API_KEY` → AsyncStorage | Same posture already litigated in `src/slack/config.ts`: plaintext by design, one phone on one desk, and secure-store would force a rebuild. |

## Architecture

### The seam

`useEcho` already took `ask?: (text: string) => Promise<AskResult>` and nothing
else. That contract moved out of `src/slack/` into `src/round/`, since two
transports now implement it:

- `src/round/ask.ts` — `AskResult`, `RoundMarks`, `formatLatency`
- `src/round/speakable.ts` — `speakableFromMrkdwn`, now handling ordinary
  markdown (`[label](url)`, bare URLs, headings) as well as Slack mrkdwn

`src/slack/sanitize.ts` keeps only `isToolEcho`/`toolLabelFromEcho`, which are
genuinely keyed to hermes' emoji-prefixed system register.

`timeout` and `offline` gained an optional `message`, so failure copy belongs to
the transport rather than being hardcoded in `useEcho`; `error.message` now
carries its own `slack · ` / `agent · ` prefix instead of `useEcho` prepending
one.

### `src/agent/`

| File | Kind | Responsibility |
|---|---|---|
| `history.ts` | **pure** | Every decision. Unit-tested, no React, no I/O. |
| `persona.ts` | pure | Eva's system prompt and the two summarizer instructions. |
| `config.ts` | I/O | Key + model, env-first then AsyncStorage. |
| `store.ts` | I/O | Session and memory files. |
| `openai.ts` | I/O | One `fetch` to `/v1/chat/completions`. |
| `useAgent.ts` | hook | All timing and side effects. |

### The request layout, and why it looks like that

`buildRequest` emits:

1. `system` — persona + remembered summaries. **Byte-identical for the life of a
   session.**
2. `system` — the running compaction summary, when there is one. Rewritten only
   when compaction fires.
3. the kept turns.

OpenAI's automatic caching matches on the longest stable *prefix*. Splitting the
mutable running summary out of the persona block means a compaction invalidates
only what follows it. Two tests pin this: the persona message must stay
byte-identical whether or not a summary exists, and as turns accumulate.

Honest limits, stated because they're easy to oversell:

- Caching needs **≥1024 prefix tokens**. Persona + 5 memories lands well under
  that, so early turns in a session get no discount; it starts paying once
  history pushes the prefix past the threshold.
- Compaction and caching pull against each other — every fold invalidates the
  suffix. So `HISTORY_BUDGET_TOKENS` is deliberately generous (3000):
  rare-and-large beats frequent-and-small. **Compaction is the primary cost
  control; caching is a discount on top of it.**

### Compaction

`planCompaction` returns `null` below budget, and also `null` when the
`KEEP_RECENT_TURNS` we promised to keep are themselves over budget — folding
into them would break the promise for no gain. Above budget it folds everything
foldable rather than just enough to fit, so it fires rarely.

It never leaves an assistant reply as the first kept turn: an answer whose
question was folded away reads as a non-sequitur, so the pair is kept together
by folding one fewer turn.

`applyCompaction` drops by **count**, not by assigning the plan's `keep`.
Summarizing is an API call that happens off the round's critical path, so the
user can speak again before it returns; slicing the current turns by `foldCount`
preserves whatever arrived meanwhile. There is a test for exactly that race.

The summary **replaces** the previous one rather than appending — the summarizer
receives the old summary as input, so what it returns is already the whole story
and stays bounded.

### Sessions and memory

`SESSION_GAP_MS` is 30 minutes, matching `ADOPTION_IDLE_MS`'s sense of when a
conversation has gone cold. On mount, a session that has been quiet that long is
archived and a fresh one started. An empty session is never a gap — nothing to
summarize, so no hollow archive.

```
<documents>/eva/
  session.json                       the live session
  memory/2026-08-15T14-22-01.json    one archived session per file
```

`sessionId()` is second-resolution ISO with filesystem-safe separators, so
listing the directory and sorting by name is chronological without reading
anything. Archives keep the raw turns alongside the summary, so a later pass
(better summaries, embeddings, a sync) still has the source.

The session summarizer may answer `NOTHING`, in which case the session is
cleared without writing a memory — better than diluting the block with "they
discussed the time."

Every store function swallows its errors: a device that cannot read its own
history should start a fresh conversation, never crash the face.

### Wiring

`eva.brainLocal.v1` (default on) selects the brain, following the same
`'1'`/`'0'` persisted-toggle pattern as the four existing ones. The `ask`
injection resolves to `undefined` when the selected brain isn't usable —
load-bearing, because that is what drops `useEcho` back to the Phase-1 echo.

The dev overlay gained a `BRAIN · <model>` section: the local/slack toggle, an
**End session** button, and the typed-ask box moved there from `SLACK` (it now
goes to whichever brain is active). Per-round token spend reaches the transcript
as `agent · 412 in (256 cached) · 89 out` — the only way to see whether the
caching claim above is actually true on device.

## Testing

Pure and near-pure modules only, per house convention — no component tests.

- `history.test.ts` (31): token estimation, gap boundaries, the compaction
  plan's invariants (pair-splitting, keep-recent, the null cases), the
  apply-time race, and request-layout stability.
- `store.test.ts` (18): an in-memory `expo-file-system` fake — round-tripping,
  corrupt-file tolerance, archive naming and ordering, the limit, and
  `clearAll`.
- `openai.test.ts` (3): the usage line.
- `speakable.test.ts` (+7): the markdown dialect.

Not covered by tests, and deliberately: the hook's timing (no
`@testing-library/*` in the project, and no precedent for hook tests) and the
`fetch` call itself. Both are exercised on device instead.

## Deliberately out of scope

- **Tools.** The loop is shaped for them; none are defined.
- **Sentence-streaming TTS.** The largest remaining latency win — speak the first
  sentence while the rest generates. Needs a queue in `tts.ts` (whose `speak()`
  pre-empts as its first statement) and a first-audio/drained split in
  `deliver()`. The layers below already stream.
- **exe.dev sync.** The file layout anticipates it; there is no sync code.
- **Local proactive push.** Still Slack-driven; `proactive.ts` untouched.
- **Retrieval over memory.** Recent-N injection only; no embeddings, no search.
- **Re-keying `asides.ts` TOOL_LINES** to local tool names. Waits for tools.
