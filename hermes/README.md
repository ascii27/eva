# hermes/ — the Eva-back half

This directory is not device code. It is what runs on (or configures)
**hermes-agent**, kept in this repo so both halves of Eva version together.

The device half is `src/hermes/`. The two have to agree about the bundle
contract, and the fastest way to break Eva is to change one without the other.

## The two halves

```
hermes-agent (Eva-back)                    iPhone (Eva-front)
  durable memory, tools, slow work           eyes, ears, mouth, personality
  POST /v1/chat/completions  ◀── pull ────   src/hermes/useBundle.ts
  OpenAI-compatible, bearer auth             every 150s, backing off when quiet
                                                        │
                                             the bundle goes in the prompt
                                                        ▼
                                             OpenAI fast model — the spoken turn
```

Two invariants. Break either and this stops being one assistant:

1. **hermes is never synchronously on the critical path of a spoken turn.** The
   device answers from whatever bundle is resident, and says how old it is.
   A refresh in flight blocks nothing; a failed refresh changes nothing.
2. **hermes is the sole writer of durable memory.** The device reads a
   projection. Two memories would mean two Evas who disagree about the week,
   with Michael as the sync layer — the thing this is escaping.

## What hermes has to provide

Just the API server. There is no bespoke endpoint, no queue, no webhook: hermes'
API server is OpenAI-compatible, so the device's existing OpenAI client talks to
it with a different `baseUrl` and two headers.

- `config/api-server.example.env` — the settings, and the one that bites (the
  default bind is loopback, which a phone cannot reach).
- `skills/eva-bundle/SKILL.md` — the skill hermes uses to *gather* the bundle
  well. Optional for correctness, load-bearing for quality.
- `schemas/bundle.schema.json` — the contract.

## Where the contract actually lives

`schemas/bundle.schema.json` is the reference copy, and the schema the skill is
written against. But the authoritative copy at runtime is the one inlined in
`src/hermes/prompt.ts` on the device.

That is deliberate. The prompt and `parseBundle` have to agree, and they ship
together in the same bundle to the same phone. Putting the schema only on the
server would mean a hermes deploy could hand the device a shape its parser was
never taught to read — a contract split across two deploy cadences, which is a
guaranteed outage with an unpleasant failure mode (Eva confidently describing an
empty afternoon).

So: **change the schema here and in `prompt.ts` in the same commit.** The skill
can then drift freely, because it only affects how well hermes gathers, not
whether the device can read the result.

## Headers the device sends

| Header | Value | Why |
|---|---|---|
| `X-Hermes-Session-Key` | `eva-device` | Stable long-term memory scope, so what hermes learns from the desk accumulates in one place. |
| `X-Hermes-Session-Id` | a bundle-only id | Keeps ~500 refreshes a day out of hermes' actual transcript with Michael. A refresh is machinery, not a conversation. |

## Delegation

Landed 2026-08-29. Eva can hand hermes something to **do**, not only something
to find out: `tell_other_half` posts an instruction down the same
`/v1/chat/completions` endpoint the errand path already uses, returns at once,
and the report arrives minutes later through the proactive queue.

Two things live on the device rather than here. **The confirmation gate** — an
action that would change something already there is read back and waits for an
audible yes before anything is sent — because the microphone is the only half
that can hear one. And **the outbox**, a journal of actions sent and not yet
answered, so a relaunch mid-flight leaves a trace instead of silence.

The Runs API this section used to point at (`POST /v1/runs`, `run_id`, an SSE
event stream, `POST /v1/runs/{id}/approval`) is still the better shape
eventually — but writes already work over chat completions, and its approval is
server-side, which is the wrong end of the room. It becomes interesting when
something other than the desk needs to approve.

Design: `docs/superpowers/specs/2026-08-29-action-errands-design.md`.

## Not here yet

Replay and the mem0 wiring. The outbox records what was sent and never
re-sends it: de-duplicating across a relaunch needs an idempotency key hermes
does not promise to honour, and a task added twice is worse than one Eva admits
losing track of. `pendingOps` in the bundle schema is still empty — the journal
is what would feed it, once hermes broadcasts.

Design: `docs/superpowers/specs/2026-08-21-hermes-bridge-design.md`.
