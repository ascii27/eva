# Chores and allowance: off Apple Reminders, onto the board + a Notion ledger

Linear: ASC-24. Status: design approved in conversation 2026-11-16, awaiting doc review.

## Why

Chores on the kitchen board come from Apple Reminders through `wallboard/sync/reminders_sync.py`, which talks to iCloud via pyicloud with a session copied from a Mac. Apple expires that session and the sync goes dark until someone logs in again with 2FA. Worse, Reminders keeps no history: ticking a repeating reminder only moves its due date, so "done" is inferred and nothing records what was ever completed.

Chores drive the girls' allowance. Michael wants:

- a durable record of every chore completed, per child, with the date;
- pay computed from completions, shown on the board **in yen** (more motivating than a count);
- payments tracked: how much each girl has earned, how much was paid and when, and the outstanding balance.

## Goals

- The board keeps working exactly as the family uses it today: one tap to tick, 8 s undo, instant feedback, works when hermes or Notion is down.
- One owner per kind of data, so there is nothing to reconcile in normal operation.
- A durable, browsable ledger in Notion that Michael can read and that hermes (Eva) can answer questions from.
- Michael changes chores, amounts and payments by asking hermes; hermes keeps Notion and the board in step.

## Non-goals

- No jester queue, no event push from the board to hermes (considered and dropped: hermes already talks to the board, and polling it is enough).
- No editing UI on the board. Single taps only (existing rule).
- No coins. Money is yen throughout.
- No migration of history (Reminders has none to migrate).

## Anti-goals (failure even if it "works")

- Losing the ledger because the board's state file was reset and a sync copied "nothing" over Notion.
- The board showing a balance that depends on hermes being up.
- An agent doing arithmetic on money: sums and diffs are code, not reasoning.
- A tap being undone and still showing up as earned.

## Approaches considered

1. **Notion as the board's live source.** The board reads chores and balances from Notion. Rejected: puts a network dependency on every tap, and is the same fragile sync loop as Reminders with a different vendor.
2. **Board pushes events to hermes via hermes-jester** (the Cadence / nihongo pattern), hermes writes Notion and periodically corrects or flags the board. Workable, but adds a service, an outbox and a reconciliation story for conflicts between two writers of activity.
3. **Chosen: split ownership, hermes polls.** Notion owns chore *definitions*; the board owns *activity* (completions, undos, payments). hermes copies definitions Notion → board and activity board → Notion on a schedule. Because each kind of data has exactly one writer, there are no conflicts to resolve.

## Ownership

| Data | Owner | Flows |
|---|---|---|
| Chore definitions: name, who, icon, schedule, amount | **Notion** (Chores db) | hermes → board via `PUT /api/eva/chores` |
| Activity: completions, undos, payments | **Board** (append-only log) | hermes copies board → Notion (Ledger db) |
| Balances | Computed | Board computes from its log for display; Notion computes from the Ledger (rollups/formula) |
| "Due today" / next due per chore | **Board** | Board computes from each chore's schedule |

A payment Michael tells Eva about ("I paid Sarina ¥500") is activity, so hermes writes it **to the board** (new endpoint), and it reaches Notion through the normal copy.

## The board (wallboard/)

### Chores and schedules

Chore definition as pushed by hermes (extends the existing `ChoreInput`):

```
{ id, title, who, icon, amount, schedule }
amount:   integer yen, ≥ 0 (100 for every chore today)
schedule: { every: N, unit: "day" | "week", start: "YYYY-MM-DD" }
```

The board replaces the Reminders sync's due-date logic with the same visible behaviour, computed locally (Tokyo time), so the family sees no change:

- A chore has a **next due** date, held by the board. Initialised to `schedule.start` (or today if start is in the past and the chore is new).
- Next due on or before today → shown, to do. An overdue chore carries over until done (as Reminders does now).
- Ticked → done until midnight; next due advances by the schedule to the first occurrence after today.
- Undo → next due goes back to what it was before the tick.
- Otherwise hidden.

`chores.replace` keeps next-due for chores whose `id` survives; a changed schedule re-anchors next-due only if the old one no longer falls on the new schedule (builder's call on the exact rule; keep it simple and tested). The `done` field on push is no longer accepted from hermes — done-ness is the board's.

### The activity log

Append-only, persisted with the rest of the state (`data/state.json`). Never edited, never trimmed (it is small: a few events a day).

```
{ id, seq, type, who, at, ... }
type "done":    { choreId, title, amount }       // amount snapshotted at the time
type "undone":  { cancels: <event id> }
type "payment": { amount, note?, source: "board" | "eva" }
```

- `id`: generated on the board (e.g. `ev-<ulid>`), unique forever. `seq`: monotonically increasing integer, so hermes can ask "everything after N".
- A tap writes a `done` event at once; Undo writes an `undone` that cancels it. Both are copied to Notion; an undone completion is never counted as earned. (Simpler than holding events back for the undo window, and the ledger shows exactly what happened.)
- `amount` is snapshotted on `done`, so changing a chore's amount later never rewrites what was already earned.
- Balance per girl = sum of `done` amounts not cancelled − sum of `payment` amounts.

### Pay on the board

Replaces the localStorage dummy (`local.owed`, `local.paidToday`, "N days to pay") in `web/app.js`:

- **Pay is per chore**: every completed chore earns its amount, whether or not she finished the rest of the day's. The old "finish all N to earn today" rule is gone.
- Active view shows **¥N to pay** per girl, from the server's balance. Zero → "Paid up".
- Second line (replaces "Includes today" / "Finish all N to earn today" etc., which only made sense for the days model): **"Last paid <Mon 14 Nov>"**, or "Not paid yet" before the first payment. Update `design/` (the pay row in `ActivePaper` / `Active`) and the "Pay" bullet in wallboard/CLAUDE.md "don't regress" first, then port.
- **Mark paid** writes one `payment` event for the full balance (source `board`), with the existing undo toast; undo appends a cancelling payment of the opposite sign or an `undone` referencing it (builder's call, but it must be append-only).
- Calm view unchanged (no pay text there, per CLAUDE.md).
- Port any visual change through `design/` first, per wallboard/CLAUDE.md. The amount string replaces the days string in the existing pay row; no new layout expected.

### API additions

hermes (bearer):

| Method | Path | Purpose |
|---|---|---|
| `PUT` | `/api/eva/chores` | Existing; now carries `amount` and `schedule`, no `done`. |
| `GET` | `/api/eva/activity?after=<seq>` | Events with `seq > after`, oldest first, plus the board's current max `seq` and a `logId` (see below). |
| `POST` | `/api/eva/payments` | `{ who, amount, note?, id? }` → appends a `payment` event (source `eva`). Idempotent on a caller-supplied `id` so a retried request doesn't pay twice. |
| `GET` | `/api/eva/balances` | Per-girl earned / paid / outstanding, for a quick answer. |

Board (cookie): `PUT /api/chores/<id>` stays a set; the server now also appends the matching log event. `POST /api/pay/<who>` for Mark paid.

### `logId` — detecting a reset board

The state file gets a random `logId` created when the log is first created. If `state.json` is lost and the board starts fresh, it gets a new `logId` and `seq` restarts at 1. hermes stores the `logId` and last-copied `seq` it has seen; a changed `logId` or a max `seq` lower than what it already copied means **the board lost history** (see "The one alarm").

### Retiring Reminders

Remove `sync/reminders_sync.py`, `sync/chores.py` (its schedule tests are a useful reference for the new TS policy), `deploy/wallboard-reminders.service`, the probe scripts, and the `chores-sync` panel. Update `wallboard/README.md` "Chores" and the push-API table. Stop and disable the systemd unit on the VM as part of the deploy.

## Notion (owned by hermes)

Three databases under one page, "Chores & allowance":

**Chores** — one row per chore
- Name (title), Who (select: Mariko, Sarina), Icon (select: board icon keys), Amount ¥ (number, default from Settings), Schedule every (number), Schedule unit (select: day, week), Start (date), Active (checkbox), Board id (text, stable, generated once).

**Ledger** — one row per board event, never deleted
- Event id (title, the board's id), Type (select: done, undone, payment), Who, Chore (relation → Chores), Amount ¥ (number; negative for payments is a builder's call — pick one convention and make the rollups match), At (date+time), Cancels (text, event id), Source (select: board, eva), Board log id (text).
- Earned/paid/outstanding per girl via a view or rollup; Michael checks this.

**Settings** — single row
- Default amount ¥ (100). New chores take it unless told otherwise.

## The `eva-chores` hermes skill

`hermes/skills/eva-chores/` alongside `eva-board-bubble`: `SKILL.md` (instructions for hermes) + `scripts/eva_chores.py` (stdlib-only, like `eva_bubble.py`).

**hermes reaches Notion and Todoist through its own built-in MCP tools** (decided 2026-11-16: they already exist and have access; no API tokens are created for this). So the split is:

- **The script talks only to the board** and does every deterministic step: reading activity, deciding which events are new, detecting the alarm, and turning events into exact Ledger rows. It never touches Notion.
- **The agent moves data between the script and Notion/Todoist** with its MCP tools, copying the script's output verbatim. It never composes a Ledger row, a balance or an amount itself.

Money arithmetic stays in code: balances come from the board (`GET /api/eva/balances`), which computes them from its log. Notion rollups are for Michael to browse, not what Eva quotes.

Script commands (shape, final names builder's call):

- `activity --log-id <id> --after <seq>` — reads `/api/eva/activity`, checks `logId`/`seq` for the alarm, and prints JSON: `{alarm: null | {...}, rows: [<exact Ledger row>...], cursor: {logId, seq}}`. Rows are oldest first.
- `push-chores` — reads chore definitions as JSON on stdin (the agent pipes in what it read from the Chores db), validates them (amount is a non-negative integer, schedule well-formed, icon known) and PUTs them to the board.
- `balances` — per-girl earned / paid / outstanding in yen, from the board.
- `pay <who> <amount> [--note] [--id]` — POSTs a payment to the board (fresh id unless given, so a retry is safe).

**The scheduled sync, as SKILL.md spells it out:**
1. Read the Chores db (MCP); pipe active chores into `push-chores`.
2. Read the cursor (`logId`, last seq) from the Settings row (MCP).
3. Run `activity` with it. If `alarm` is set, follow "The one alarm" and stop.
4. For each row, check whether a Ledger row with that Event id already exists (MCP query); if not, create it exactly as given. This makes a retried or half-finished run safe.
5. Write the new cursor to the Settings row — only after every row is in.

**Changes Michael asks for** (add/edit/retire a chore, change an amount or the default): write Notion first (MCP), then re-read the Chores db and run `push-chores`. Not done until both succeed; if the board push fails, say so (Notion is right, the next sync pushes again).

**Payments told to Eva** go to the board (`pay`), never straight into Notion; they reach the Ledger on the next sync (the agent may run the sync straight after).

**Setup** (one-time, by hermes with MCP, following a section of SKILL.md): create the "Chores & allowance" page and the three databases with the exact property names above, and the per-girl views. The script finds nothing by name; Notion IDs live only in hermes' use of its tools, and the cursor lives on the Settings row so it survives a hermes reinstall.

SKILL.md must tell hermes, at least:
- when to use it (scheduled sync; anyone asking about chores, allowance, paying; Michael asking to change chores or amounts);
- that Notion owns definitions and the board owns activity, and therefore: never edit or delete Ledger rows, never "fix" activity in Notion, never push `done` to the board;
- copy the script's rows verbatim; never compute or adjust an amount; never hand-write HTTP to the board;
- how to answer "how much does Sarina have coming?" (`balances`) in a sentence, in yen;
- the alarm procedure below.

### Schedule

`sync` runs on hermes' cron. Every 15 min is a reasonable start (cheap: one GET and usually zero writes); builder's call. A chore-definition change made through the skill pushes immediately, so the cadence only bounds how stale the Notion ledger can be.

### The one alarm

Only one thing is flagged, because it is the only thing that can destroy data: **the board has lost history** (new `logId`, or its max `seq` is below the last one copied, or the activity read shows event ids Notion already has with different contents).

When that happens the sync **stops copying activity** (step 1 still pushes definitions, so the board keeps working) and hermes, with its MCP tools:
1. records the alarm on the Settings row (what the script reported, and when) — unless that same alarm is already recorded;
2. only when it newly recorded it: creates a Todoist task for Michael, priority urgent (p1), due today, linking to the Settings page. Once per distinct alarm, never every run.

Michael resolves it by hand; how (e.g. re-seeding the board's log from Notion) is out of scope for v1. The alarm must not auto-repair.

## Switchover

1. The Reminders sync and the new board must not run together (they would fight over the chore list). Order: read each #Chore reminder's title, recurrence and **current due date** (while the iCloud session still works; `scripts/probe-reminders.py` already reads them) → create the Notion databases and enter the chores with ¥100 each and **Start = that due date**, so an every-2-days or weekly chore keeps its phase and nothing comes due on a different day → deploy the board → stop the Reminders unit → install `eva-chores` on hermes and add the cron job → run `sync` once by hand and check the board.
2. Pay starts from ¥0 for both girls on switchover day, unless Michael gives hermes an opening balance to record as an adjustment (builder: support a signed `payment`/`adjustment` via the script so this is possible).

## Testing

- Board: `node:test` for the pure parts in `server/state.ts` (schedule/next-due, log append, undo cancel, balance, `logId`), same style as today's `state.test.ts`. Port the useful cases from `sync/test_chores.py` (overdue carries over, tick advances past today, undo restores).
- Script: unit tests for the pure parts (alarm detection, event → Ledger row, chore validation) with a fake board. The agent half is checked with one live run against a scratch Notion page before touching the real one.
- On the device: `?time=` to check midnight rollover and the pay row.

## Left to the builder

Exact undo representation for Mark paid; the next-due re-anchor rule on schedule edits; payment sign convention in Notion; cron cadence; script command names; ID format.
