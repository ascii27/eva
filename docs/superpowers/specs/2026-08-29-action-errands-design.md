# Action errands — Eva can ask her other half to *do* things — design

Status: **implemented and measured 2026-08-29** on `feat/action-errands`.
Device verification still outstanding.

| `npm run probe:action`, `gpt-5.4-mini` | First run | Shipped |
|---|---|---|
| Handed over rather than refused or asked | 4/6 | **6/6** |
| `changes_existing` set correctly | 4/6 | **6/6** |
| Preamble phrased as a question when the gate is armed | 1/3 | **2/3** |
| Acknowledgement claiming it is already done | 0/4 | **0/6** |
| Controls still reaching the tool that answers | 1/2 | **2/2** |

`npm run probe:errand` after the change: 4/4 delegated, 2/2 controls, 0/4
repeated preambles — the new spec does not shadow the old one.

The first run found the failure this design predicted, in the direction it did
not: `ask_other_half` captured *modify-existing* requests ("move my three
o'clock to tomorrow", "mark the scope note task as done"), because those need a
lookup before they can be done and the pull towards asking is strong. The fix
was the same one that fixed `memory_search` shadowing `ask_other_half` — draw
the line in *both* descriptions, and say why: an instruction sent down the
question tool still gets done, but Michael is never asked first. That, in the
`question` parameter's own description, is what took it to 6/6.

The remaining 1/3 is a model that announces a destructive change rather than
asking about it. It degrades safely by construction: the machine gate still
fires and speaks `readbackLine` itself, exactly as `CONSENT_QUESTION` covers
the camera for the models that skip its preamble.

Eva can read Michael's world and cannot act on it. `persona.ts` says so in as
many words, and that sentence is currently true:

> What you still can't do from the desk is act. Sending a message, moving a
> meeting, writing something down where it stays written, opening his files or
> his terminal — none of that reaches from here yet. Say so when it comes up,
> and don't promise to do it later.

hermes-agent can already perform those writes today, through the same
OpenAI-compatible `/v1/chat/completions` endpoint the errand path already posts
to. So the gap is entirely device-side. This document is the delegation half
that `hermes/README.md` has been pointing at since the bridge landed:

> Delegation, the outbox, and the mem0 wiring. The device can currently *read*
> Michael's world and cannot *act* on it — she is told to say so plainly rather
> than promise.

and that `hermes/schemas/bundle.schema.json` reserved a slot for:

> `pendingOps` — Reserved. Always empty until the device has an outbox.

## What ships

A second tool, `tell_other_half`, riding the errand machinery that already
exists. Eva hands hermes an action, hermes does it, and the report arrives
minutes later through the proactive queue — exactly as an answer does today.

Two things are new rather than borrowed: a **spoken confirmation gate** in front
of anything that changes something that already exists, and a **disk journal**
so an action in flight when the app dies leaves a trace instead of vanishing.

## Why a second tool, and not a parameter

`ask_other_half` could take a `kind: 'question' | 'action'`. It should not.

Tool wording on this path is measured and load-bearing. `memory_search`
shadowed `ask_other_half` on the first live run — Eva searched her own notes,
found nothing, and stopped rather than escalating; drawing the line sharply in
both descriptions ("conversations at this desk" vs. his actual world, and
*escalate on an empty result*) took delegation from 1/4 to 4/4. A tool whose
description opens "Send a question to your other half" is the wrong one to
overload with acting, and a description that has to serve both is a description
that draws no line at all.

The cost of a second spec is a few hundred tokens inside a cached prefix. The
cost of a blurred one is Eva not delegating.

## Why not hermes' Runs API

`hermes/README.md` predicts it, and it is the right shape eventually:

> hermes' Runs API (`POST /v1/runs`, `run_id`, an SSE event stream, and
> `POST /v1/runs/{id}/approval`) is the natural transport: it already has the
> shape delegation needs, including approvals, which maps onto the spoken-consent
> gate the camera already uses.

Two reasons to skip it for now. Writes work over chat completions today, so a
second transport buys nothing this pass. And the approval it offers is
server-side, while the gate that matters here is a microphone in a room — the
device is the only half that can hear a yes. Server-side approval becomes
interesting when something *other* than the desk needs to approve.

## The confirmation rule

**Additive fires; destructive confirms.** Adding a task, creating a page,
drafting something new — these go at once, and Eva says what she sent. Anything
that edits, moves, reschedules or deletes something that already exists is read
back and waits for an audible yes.

Eva classifies, through a `changes_existing` boolean on the tool, the same way
she already classifies `needs_lookup`. That is the weak point of the design and
it is deliberate: a wrong `false` is a write that skips the gate. It is also not
knowable by reading code, which is why `scripts/probe-action.ts` measures it
across an add, an edit and a delete before any of this reaches the device.

The gate itself is `useEcho`'s existing `askForConsent`, which turns out to be
generic — only its fallback question is camera-specific. `readConsent` is reused
untouched, including the rule that a refusal beats an affirmative in the same
breath ("no, don't do it" contains "do"), which matters at least as much for a
deleted meeting as for a photo.

## The journal, and what it is not

Every action is written to disk on dispatch and settled when hermes answers.
At mount, anything left `queued` or `running` by a dead process is reported once
— "before we restarted I'd sent that and never heard back".

It does **not** replay. Re-sending an action across a relaunch needs
de-duplication, and de-duplication needs an idempotency key hermes does not
promise to honour; a duplicated write is worse than an unreported one. hermes
stays the single record of truth, and the honest thing Eva can say is that she
does not know — which is precisely what `pendingOps` was reserved to let her say
properly, once hermes broadcasts (#13).

Questions are not journalled. A lost question costs nothing; you ask again.

## Shape

```
model emits tell_other_half{action, changes_existing}
  └─ ToolKit.run                          src/agent/tools/index.ts
       ├─ changes_existing && no gate  → decline, do not send
       ├─ changes_existing             → onConsent(readbackLine(action))
       │                                    └─ no → "he said no", nothing sent
       └─ ErrandHandles.send(action)    (sync, returns id | null)
            └─ useErrands.send          → outbox.record()
                 └─ chat()  POST {hermes}/chat/completions
                      body: actionRequest(action)

...minutes later...
  └─ outbox.settle(id, 'done')
  └─ onResult(doneLine(action, report))  → proactive queue → announce()

...or, at next launch...
  └─ outbox.unfinished() → one line through the same queue
```

`Errand` gains `kind: 'question' | 'action'`. Actions share the queue, the
`MAX_RUNNING`/`MAX_QUEUED` caps, the per-errand `X-Hermes-Session-Id` scoping,
and the rule that a failure is spoken rather than swallowed.

## The persona rewrite is the risky edit

Removing the inability paragraph is what makes the tool reachable at all. It is
also the edit most likely to break something, for a reason `persona.ts` already
records: a remembered or instructed inability reliably beats an instruction
saying she can — measured at 0/3 tool calls against 3/3.

So the replacement keeps the shape that works. She still cannot reach anything
from the desk *herself*; what is new is that she can hand it to the half that
can. She says she will get it done rather than that she cannot, and she does not
report it done until it comes back. What it must not become is a flat list of
new powers, and it must stay byte-identical for a session — it is the cached
prefix.

`probe:errand` has to still pass afterwards. The regression to watch is the new
spec shadowing the old one, the same way `memory_search` once did.

## Out of scope

- Replay and de-duplication — the rest of #10. The journal records; it does not retry.
- Populating `pendingOps` in the bundle. The journal is what would feed it, but
  the broadcast is #13.
- Any hermes-side change.
