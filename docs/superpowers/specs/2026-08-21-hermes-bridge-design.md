> **Superseded in part, 2026-08-21.** The pull-a-bundle-on-a-timer design below
> was measured and abandoned the same day. hermes is now reached by **errand** —
> Eva hands it a question, says she'll come back to him, and the answer arrives
> minutes later through the proactive queue. The bundle machinery survives as the
> receiving half for a future phase in which hermes *broadcasts*; nothing polls.
>
> What changed and why is at the end, under **What the measurement changed**.
> Everything about message layout, the absent-vs-empty rule, and the rejected
> parts of the harness spec still stands.

# The hermes bridge — context bundle (read path) — design

Status: **implemented and measured once, against the live gateway at
`orbit-python.exe.xyz` on 2026-08-21.** It works end to end: hermes returned a
bundle of real goals and real overdue tasks, it parsed, and it rendered to 572
tokens of prose that reads correctly out loud.

One measurement invalidates part of this document, and it is the one the status
note above was written to catch.

| | Measured |
|---|---|
| Round trip | **88.7s** — within 2s of the client's own 120s timeout |
| hermes-side prompt tokens | **325,546** for one bundle |
| hermes-side completion tokens | 2,634 |
| Rendered core on the device | **572 tokens** — a fifth of the 2,500 budget |
| `max_completion_tokens` | accepted |
| Model id | `hermes-agent`, not `hermes` (fixed) |

**The 150-second cadence in this document is wrong and must not ship.** A bundle
costs hermes ~325k prompt tokens because it is a full agent run — 112 skills, its
own system prompt, memory, and several tool laps, all resent per lap. At 150s
that is ~576 runs a day and something on the order of 190M tokens a day. The
device side is not the problem and never was: 572 tokens in the prompt is
cheaper than the section that describes budgeting it.

The 89s round trip constrains this independently — a refresh occupies more than
half of any two-minute window before cost enters the argument.

Cadence and the staleness thresholds are also coupled in a way this document
missed. `STALE_AFTER_MS` is 10 minutes; any cadence at or above that leaves Eva
permanently hedging, because the bundle is stale more often than it is fresh.
The two numbers have to move together.

### What else the first run showed

- **The honesty instruction works, and it worked without the skill installed.**
  Google Calendar was unreachable (its connection needs re-authorizing), and
  hermes left the section out entirely and said why in `identity` — exactly the
  behaviour `prompt.ts` asks for. Eva will say she can't see his calendar rather
  than describing an empty one. That is the absent-vs-empty distinction earning
  its keep on the very first run.
- **`people`, `decisions`, and `openLoops` came back absent.** hermes had nothing
  to say about them and correctly said nothing. That is the gap
  `hermes/skills/eva-bundle/SKILL.md` exists to close, and it is **not installed**
  on the gateway (112 other skills are).
- Sections that did arrive — five goals, ten overdue items across work, personal,
  and inbox — are specific and well written for the ear without any tuning.

### Still open

- What that 325k actually *bills*, which depends on hermes-side prompt caching
  across its laps. The face value is alarming; the marginal cost may not be.
- The tier-0 rate. `useAgent` counts it and prints `N% direct` on every usage
  line. Needs the device and a week.
- Everything on the device: whether Eva answers goal and task questions without
  reaching for a tool, and whether the stale and out-of-sync wording sounds
  right out loud.

One thing changed during implementation, and it was the opposite of the first
instinct: **the bundle goes early in the message list, not late.** Late placement
protects the cached prefix but means the bundle is never *in* it, so its tokens
are billed in full on every turn. See the layout note in `buildRequest`.

A second, smaller correction: `bundle.ts` carries its own copy of the four-chars-
per-token estimator rather than importing `history.ts`'s. Node's type stripping
resolves relative imports only with an explicit `.ts` extension, no app file here
uses that style, and putting an untested import form in the Metro path for a
two-line function was the worse trade. Found by running the probe rather than by
reasoning about it.

## The problem

Eva on the desk does not know what Michael's day looks like. `persona.ts`
instructs her to say so:

> A few things genuinely have no tool: his calendar, Slack, Notion, his files,
> the terminal. Say plainly you can't reach those from the desk rather than
> implying you tried.

The real hermes-agent knows all of it. Today the only route to it is the Slack
transport, which means switching the whole brain over — 50-90s per answer, no
streaming, no local tools, no vision gate. The two Evas are not a spectrum you
can slide along; they are a toggle, and neither position is what you want.

## Strategy: two embodiments, one Eva

Lifted from the harness spec, and the reason this design exists rather than a
different one.

- **Device (Eva-front)** — eyes, ears, mouth, personality. Owns every
  synchronous spoken turn, and resolves it against a resident context bundle
  plus one fast model call.
- **hermes (Eva-back)** — durable memory, tool execution, long-running work.
  Owns everything that cannot finish inside a spoken turn.

Two invariants carry the whole thing:

1. **hermes is never synchronously on the critical path of a spoken turn.**
   Every turn resolves against the resident bundle. Anything slower is not
   waited on.
2. **hermes is the sole writer of durable memory.** The device reads a
   projection. Separate memories would mean two Evas who disagree about your
   week, with you as the sync layer — the exact failure this is escaping.

This document covers the read path only: hermes → device projection.
Delegation, the outbox, and mem0 wiring come next and are deliberately absent.

## The transport is not new

hermes-agent's API server is fully OpenAI-compatible: `POST
/v1/chat/completions`, bearer auth, SSE streaming, plus `X-Hermes-Session-Id`
(transcript scope) and `X-Hermes-Session-Key` (stable long-term memory scope).

So there is no new client to write. `src/agent/openai.ts` hardcodes `BASE`; it
becomes an option. A bundle refresh is one `chat()` call with a different
`baseUrl` and two extra headers. That is the entire transport story, and it is
worth stating plainly because the harness spec assumed a bespoke push channel
and a queue, neither of which is needed.

**Pull, not push.** The spec has hermes pushing a bundle every 150s. The phone
is behind NAT with no inbound route but the Slack socket, so a push would mean
either new server surface or routing 2,500 tokens of JSON through a chat
channel every two and a half minutes. The device polls instead: one credential,
no new surface, and the device gets to decide when it is a good moment.

**JSON down, prose rendered here.** hermes returns the bundle as JSON; the
device renders it to the text that goes in the prompt. hermes decides
*content*, the device decides *presentation*. Three things fall out of that
boundary: the renderer is pure and unit-testable, the device can *enforce* the
token budget by truncating (asking a model to respect 2,500 tokens does not
work), and freshness can be rendered from the device's own clock instead of
being baked into what hermes said.

## Message layout, and why the bundle goes early

`history.ts` currently lays a request out as:

```
[persona + memories]     byte-identical for the whole session
[running summary]        rewritten only on compaction
[turns]
```

That layout is load-bearing for cost, and CLAUDE.md records why: OpenAI's
automatic caching matches on the longest stable *prefix*, so a compaction that
rewrites the summary must not disturb the persona block ahead of it.

The bundle joins it, **most-stable first**:

```
[persona + memories]     unchanged for the session
[running summary]        rewritten only on compaction (rare)
[bundle core]            rewritten only when content actually changes
[bundle volatile]        small; freshness, from the device's own clock
[turns]
```

The instinct is to put volatile data *last* to protect the prefix. That
instinct is wrong here, and it is worth writing down because it is wrong in a
convincing way. Last placement means the bundle is never inside the cached
prefix, so it costs ~2,500 uncached tokens on **every turn**. Early placement
means it costs them only on the turns where the bundle actually changed —
roughly one turn in however many fit inside a refresh interval. Early wins, and
it wins by more the more you talk.

The core/volatile split earns its keep for the same reason. Staleness is
rendered from `Date.now()` against `bundle.generatedAt`, so the core block is
byte-identical across any refresh that did not change the content — and
`useBundle` skips applying a bundle whose rendered core matches the current one,
so an unchanged refresh costs nothing at all.

## Bundle contract

`hermes/schemas/bundle.schema.json` is the authority. The sections are the
harness spec's, unchanged, because they are a good list:

| Section | What it holds |
|---|---|
| `identity` | current mode, name handling — persona stays on the device |
| `goals` | active goals, status, this week's commitments |
| `temporal` | timezone, day context (workday / weekend / travel) |
| `calendar` | next 12h in detail, next 72h in summary |
| `tasks` | today, overdue, explicitly deferred |
| `people` | frequent contacts, roles, open threads with each |
| `decisions` | last ~7 days of decisions and their rationale |
| `openLoops` | what Eva is waiting on, what Michael owes someone |

`pendingOps` is defined in the type and always empty. It is derived from the
outbox, which does not exist yet; naming it now stops the shape changing later.

The **prompt lives on the device**, in `src/hermes/prompt.ts`, carrying the
instruction *and* the schema. It is deliberately not delegated to the
hermes-side skill file: `prompt.ts` and `parseBundle` have to agree, and
splitting a contract across two deploys is how you get a device that cannot
read what its server just sent. `hermes/skills/eva-bundle/SKILL.md` improves
*how hermes gathers* the material, not what shape it hands back.

## Failure and staleness

The rule from the spec, kept verbatim in spirit: **a failed fetch keeps serving
the previous bundle — never fall back to an empty one.** `parseBundle` returns
`null` rather than a partial, so there is no path by which a malformed response
degrades into an Eva who confidently believes the afternoon is free.

| Bundle age | Behaviour |
|---|---|
| < 10 min | Nothing added. She answers directly. |
| 10–30 min | Volatile block instructs her to hedge on time-sensitive recall — "as of a few minutes ago, you had…" |
| > 30 min | Volatile block says she is out of sync, and to say so rather than assert calendar or task specifics |

A bundle is persisted to disk (`<documents>/eva/bundle.json`, following
`src/agent/store.ts`'s expo-file-system pattern), so a relaunch has a picture —
correctly marked stale — before the first refresh returns.

## Refresh cadence

The spec says every 150s. That is right while someone is in the room and wrong
overnight: 150s forever is ~576 hermes runs a day on an appliance that spends
most of the night alone in a dark room, each one a full agent run with tools.

`refreshInterval(now, lastInteractionAt)` keeps 150s while there has been
recent interaction and backs off to 15 minutes after an hour of silence. Waking
Eva does not wait for a refresh — it starts one and answers from what is
already resident, saying how old it is. That is the honest behaviour and it
keeps the hard invariant intact.

A refresh is also deferred while the face is mid-round, so it never competes
for the network with a turn someone is listening to.

## What this design rejects from the harness spec

Recorded because each was considered, and because the reasons are the kind that
get forgotten and re-proposed.

**The strict-JSON tier envelope (§4).** `{tier, speak, bridge, tool, delegate}`
cannot stream. Kokoro is fed from token deltas through `sentences.ts`, and a
`"speak"` field inside a JSON object is not available until the object closes —
so time-to-first-audio would go back to scaling with reply length, which is the
exact regression the streaming work exists to prevent. Tiering survives as
something *measured*: a turn that called no tool was a tier-0 turn, and the
`[agent]` lap log already says so.

**The bridge utterance as a new field (§2).** Already built, and better. The
model emits its preamble as ordinary content on the same response as the tool
call, so it streams and speaks through the tool gap with no extra round trip.
`persona.ts` documents that sentence as load-bearing; `TOOL_LINES` covers
models that skip it, which is measurable per model via `npm run probe:tools`.

**Barge-in (§8).** `useWakeWord` is suspended while Eva speaks *by design* —
one microphone, one speaker, one room, no echo cancellation. CLAUDE.md: "she
must never wake on her own voice." The spec is right that barge-in matters;
reversing that invariant is its own design conversation with its own device
measurements, not a line item here.

**The `stale` face desaturation (§8).** The face is a port of an approved
design (`Eva Face.dc.html`), and CLAUDE.md forbids inventing animation values —
change the design first, then port. Staleness surfaces in the side column
instead, which is ours to change.

**Bundle tiering, `core_hot` / `core_warm` (§3).** The spec says do not build it
in v1 and measure first. Agreed.

## Open questions this design does not answer

- What a hermes bundle run actually costs in wall-clock and tokens. If it is
  60s and expensive, 150s is the wrong cadence and this document is wrong about
  something load-bearing.
- Whether hermes accepts `max_completion_tokens` (every OpenAI family does;
  hermes is compatible but is not OpenAI).
- Whether the tier-0 hit rate lands anywhere near the spec's 70%. The spec's
  own read is that below ~60% the bundle is too thin rather than the model too
  weak — which is a claim about section content, and only real usage settles it.

`npm run probe:hermes` answers the first two in a few seconds. The third needs
the device and a week.


## What the measurement changed

The first live run against the gateway did what the status note at the top was
written to allow: it invalidated the central mechanism.

**A bundle is not cheap and it is not fast.** 325,546 hermes-side prompt tokens
and 88.7 seconds, because it is a full agent run — 112 skills, its own system
prompt, memory, several tool laps, all resent per lap. On a 150-second cadence
that is ~576 runs and on the order of 190M tokens a day, most of them produced
at three in the morning for nobody. No adjustment to the interval rescues the
shape; the shape was wrong.

**So hermes became something Eva asks, not something the device polls.**

`ask_other_half(question, needs_lookup)` hands over a question and returns *at
once*. Her preamble streams and speaks as every tool preamble does, the gap is
milliseconds instead of 89 seconds, and the round settles at local speed. She
says she'll come back to him and carries on. When the answer lands it becomes a
`ProactiveItem` and rides the queue that already speaks her unprompted Slack
messages — the backlog cap, the wait for a quiet face, `announce()`. There was no
delivery mechanism to build, only one to reuse.

This keeps the hard invariant more honestly than the bundle ever did. The bundle
kept hermes off the critical path by having prefetched *in time*; the errand
keeps it off by never being on it.

`needs_lookup` is Eva's call per question, because it is most of the wall-clock:
a full agent run against calendar and tasks, or an answer from memory. The
request also asks hermes for brevity and low reasoning every time — the answer is
read aloud in a room, and hermes writing for a chat window produces paragraphs
nobody can listen to.

### What the errand probe changed in the code

`npm run probe:errand` runs the round for real against OpenAI and stubs the tool
result, so both risks could be measured rather than argued about.

- **`memory_search` shadowed the new tool.** Asked "did Ana ever reply about the
  scope note", Eva searched her own notes, found nothing, and *stopped* —
  "I don't see anything in my notes." Only 1 of 4 questions reached the other
  half. Drawing the line in both descriptions — memory covers conversations at
  this desk, and an empty result there is the strongest signal the answer is
  elsewhere — took it to **4/4**, with the controls still going to `web_search`
  and `clock`. She now says "I'm not finding a note on that, so I'll ask my other
  half" unprompted.
- **The double-speak risk did not materialise.** 0 of 4 repeated the preamble in
  the acknowledgement. It was worth checking: she speaks once before the tool and
  once after, four seconds apart.

### What survives, and what it is waiting for

Everything below the arrival of a bundle: `parseBundle`, `budgetCore`,
`renderCore` / `renderVolatile`, the staleness thresholds, `store.ts`, and
`buildRequest`'s parameter. That is precisely the receiving half a broadcast
needs, and the plan is that hermes will push on its own schedule with no tool
runs, with the device only listening. `useBundle.refresh()` still works and is
wired to the dev overlay's button — a person pressing it, not a timer.

The absent-vs-empty rule earned its keep on the very first live run and is the
reason to keep the rest: Google Calendar was unreachable, hermes omitted the
section and said why in `identity`, and Eva will say she can't see his calendar
rather than describing an empty afternoon.

### Still open

- Whether Eva delegates well *on the device*, in conversation, rather than in a
  probe with one question and no history.
- Whether an answer arriving four minutes later, re-anchored by `deliveryLine`,
  actually lands as helpful rather than as an interruption.
- What an errand bills. `needs_lookup: false` should be far cheaper than the
  325k a full bundle cost, but that has not been measured.
- Errands do not survive a relaunch — they are in memory only. Fine for
  questions; delegating *actions* would need the durable outbox and idempotency
  keys from the harness spec.
