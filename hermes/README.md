# hermes/ — the Eva-back half

This directory is not device code. It is what runs on (or configures)
**hermes-agent**, kept in this repo so both halves of Eva version together.

The device half is `src/hermes/`.

## The two halves

```
hermes-agent (Eva-back)                    iPhone (Eva-front)
  durable memory, tools, slow work           eyes, ears, mouth, personality
  POST /v1/chat/completions  ◀── errand ──   src/hermes/useErrands.ts
  OpenAI-compatible, bearer auth             returns at once; the answer
                                             lands minutes later, spoken
                                             through the proactive queue
                             ◀── turn ────   src/hermes/useHermes.ts
                                             (the experimental hermes brain)
```

Two invariants. Break either and this stops being one assistant:

1. **hermes is never synchronously on the critical path of a local brain's
   spoken turn.** An errand returns at once and the round settles at local
   speed; the answer is delivered later.
2. **hermes is the sole writer of durable memory.** Two memories would mean two
   Evas who disagree about the week, with Michael as the sync layer — the thing
   this is escaping.

## What hermes has to provide

Just the API server. There is no bespoke endpoint, no queue, no webhook: hermes'
API server is OpenAI-compatible, so the device's existing OpenAI client talks to
it with a different `baseUrl` and two headers.

- `config/api-server.example.env` — the settings, and the one that bites (the
  default bind is loopback, which a phone cannot reach).

## Skills

- `skills/eva-board-bubble/` — Eva's speech bubble on the kitchen board. Also used when the board itself tells hermes the girls ticked chores (ASC-29; `wallboard/server/react.ts`).
- `skills/eva-chores/` — the chores ledger: copies board activity into Notion, pushes chore definitions, records payments, answers allowance questions.
- `skills/eva-events/` — Tokyo events the family picked on the kitchen board: puts them on the family calendar, or takes them off, and reports back to the board.
- `skills/eva-desk-sleep/` — the `[[sleep]]` / `[[wake]]` directives that put the desk face to sleep or wake it.
- `skills/eva-desk-camera/` — the `[[look]]` request: asking to see through the desk camera, which the device always gates on a spoken yes (ASC-43). On the hermes brain the same rule rides in `DESK_PREAMBLE`; this skill is for asking over Slack.
- `skills/eva-desk-location/` — the `[[location]]` request: which town the desk is in, answered in Slack like `[[battery]]` with no spoken ask (ASC-44).
- `skills/eva-desk-battery/` — the `[[battery]]` request: hermes reads the desk phone's battery and charging state, answered by the desk in Slack (ASC-45).
- `skills/eva-desk-light/` — the `[[light]]` and `[[brightness]]` tokens: hermes measures the room's light through the desk camera (as a meter only) and reads or sets the screen brightness, answered by the desk in Slack (ASC-46).
- `skills/eva-desk-slack/` — everything hermes does in `#eva-direct` (`ask battery|light|brightness|location`, `post`, `read`), through `scripts/eva_slack.py` rather than curl (ASC-49). Hand-built `curl … | python3 -c …` trips tirith's `curl_pipe_shell` finding. That finding is session-scoped by design, so `command_allowlist` can't cover it, and it asked for approval on every desk turn and is denied outright in cron. A plain `python3 eva_slack.py …` raises no finding. The script reads `SLACK_BOT_TOKEN` from `~/.hermes/.env` itself, because hermes strips it from the terminal tool's environment, and it can only reach `#eva-direct`. The `eva-desk-battery`, `-light` and `-location` skills point at it.

## Headers the device sends

| Header | Value | Why |
|---|---|---|
| `X-Hermes-Session-Key` | `eva-device` | Stable long-term memory scope, so what hermes learns from the desk accumulates in one place. |
| `X-Hermes-Session-Id` | per errand, or per spoken session on the hermes brain | Keeps the desk's machinery out of hermes' actual transcript with Michael, and on the hermes brain is the only copy of the conversation. |

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

## The kitchen board bubble

Added 2026-11-16. hermes writes the speech bubble of the small Eva on the
family wallboard (`wallboard/`, `https://eva-board.exe.xyz`) a few times a day.
The board side is the `eva` panel (`wallboard/README.md`); this side is
`skills/eva-board-bubble/`: a `SKILL.md` that says what is worth saying and how,
and `scripts/eva_bubble.py` (stdlib only) that reads the board and pushes to it.
The script enforces the length limits and refuses rather than trims, because the
board would cut an over-long message mid-sentence.

Setup on the hermes host:

1. Copy `skills/eva-board-bubble/` to `~/.hermes/skills/eva-board-bubble/`.
2. Add to `~/.hermes/.env`:
   ```
   WALLBOARD_URL=https://eva-board.exe.xyz
   WALLBOARD_TOKEN=<the board's HERMES_TOKEN>
   ```
   (`ssh eva-board.exe.xyz sudo grep HERMES_TOKEN /etc/wallboard.env`). Check that
   hermes' terminal tool actually sees it: ask hermes to run
   `python3 ~/.hermes/skills/eva-board-bubble/scripts/eva_bubble.py read`. A
   "WALLBOARD_TOKEN is not set" means the variable isn't reaching the subprocess.
3. Schedule it. Ask hermes for a daily job at 06:30, 12:00, 15:30 and 18:30
   (Tokyo) whose prompt is: *"Update Eva's bubble on the kitchen board, using the
   eva-board-bubble skill."* The skill's time-of-day table is written for those
   four slots; the board hides the bubble from 21:30 to 06:30.

Each run is a full agent run (reading the calendar, maybe news), so it costs a
few seconds of hermes time, four times a day. The script keeps its own log of
what it pushed (`~/.hermes/eva-board/bubble-log.jsonl`) so hermes can avoid
repeating itself without relying on memory.

## Not here yet

Replay and the mem0 wiring. The outbox records what was sent and never
re-sends it: de-duplicating across a relaunch needs an idempotency key hermes
does not promise to honour, and a task added twice is worse than one Eva admits
losing track of.

Design: `docs/superpowers/specs/2026-08-21-hermes-bridge-design.md`.
