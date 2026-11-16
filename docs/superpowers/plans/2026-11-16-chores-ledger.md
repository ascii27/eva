# Chores ledger (ASC-24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Apple Reminders chore sync with a board-owned schedule and activity log, pay shown in yen, and an `eva-chores` hermes skill that copies chore definitions Notion → board and activity board → a Notion ledger.

**Architecture:** The wallboard server (`wallboard/server/state.ts`, pure) gains chore schedules, an append-only event log with a `logId`, and balances; clients and hermes read a derived *view*, so `web/app.js` and `eva_bubble.py` keep reading `chores: [{id,title,who,icon,done}]`. A stdlib Python script in `hermes/skills/eva-chores/` talks only to the board and emits exact Notion rows; hermes moves them into Notion/Todoist with its own MCP tools, following `SKILL.md`.

**Tech Stack:** Node 24 (TypeScript via type stripping, `node:test`, no framework), vanilla JS web app, Python 3 stdlib + `unittest`.

**Spec:** `docs/superpowers/specs/2026-11-16-chores-ledger-design.md`

## Global Constraints

- Branch: `michaelroygalloway/asc-24-move-chores-backing-off-apple`. Commit after each task; never push or deploy without asking Michael.
- All "today" logic is Tokyo time (UTC+9, no DST). Dates are `YYYY-MM-DD` strings.
- Money is integer yen. Every chore is ¥100 today; the default lives in Notion, never hard-coded in the board.
- `server/state.ts` and `server/schedule.ts` stay pure: no I/O, no clock, no randomness — callers pass `at` and ids.
- The log is append-only: never edit, reorder or delete an event. Undo appends an event that cancels.
- hermes never pushes `done` to the board; `PUT /api/eva/chores` rejects a `done` field.
- The script never touches Notion or Todoist; the agent never computes an amount.
- wallboard rule: `web/` is a port of `design/`. Change the design file and `wallboard/CLAUDE.md` before the code.
- Silk: no new animation; the pay row keeps its existing layout.
- Root jest/tsc exclude `wallboard/`; run wallboard checks from `wallboard/`: `npm test`, `npm run typecheck`.

## Review Focus

1. **Midnight rollover with an open board** — a chore ticked at 23:59 must show as to-do (or hidden) after 00:00 Tokyo without a reload. Test: `view` at the next day's `at` (Task 2) + the server's minute timer rebroadcasting on day change (Task 3).
2. **Overdue chore ticked days late** — next due must land on the first schedule occurrence *after today*, not one step after the old due date. Test in Task 1 (`nextAfter`).
3. **Undo after midnight** — un-ticking a chore that was done yesterday must be a no-op (no `undone` event, no balance change). Test in Task 2.
4. **Retried payment** — the same payment id posted twice records one payment. Test in Task 2 (`payment` idempotent) and Task 5 (`pay --id`).
5. **Board state file from before this change** — `reviveState` on an old file (chores without `schedule`, no `logId`/`log`) must not crash, must keep panels, and must get a fresh `logId`. Test in Task 2.

---

### Task 1: Schedule math (`server/schedule.ts`)

**Files:**
- Create: `wallboard/server/schedule.ts`
- Test: `wallboard/server/schedule.test.ts`

**Interfaces:**
- Produces:
  - `export interface Schedule { every: number; unit: 'day' | 'week'; start: string }`
  - `tokyoDay(at: number): string` — the Tokyo calendar date of a ms timestamp.
  - `nextAfter(s: Schedule, day: string): string` — first occurrence strictly after `day` (occurrences are `start + k·every·(1|7)` days, k ≥ 0).
  - `firstOnOrAfter(s: Schedule, day: string): string` — first occurrence ≥ `day` (`start` itself if `start ≥ day`).
  - `parseSchedule(raw: unknown): Schedule | string` — validates `every` integer ≥ 1, `unit` in day/week, `start` a real `YYYY-MM-DD`; returns an error string otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
test('tokyoDay rolls over at 15:00 UTC', () => {
  assert.equal(tokyoDay(Date.parse('2026-11-16T14:59:00Z')), '2026-11-16');
  assert.equal(tokyoDay(Date.parse('2026-11-16T15:00:00Z')), '2026-11-17');
});
test('nextAfter: daily, every 2 days, weekly', () => {
  assert.equal(nextAfter({ every: 1, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-17'), '2026-11-19');
  assert.equal(nextAfter({ every: 1, unit: 'week', start: '2026-11-02' }, '2026-11-16'), '2026-11-23');
});
test('nextAfter skips past today for an overdue chore', () => {
  // due 11-03 every 2 days, ticked on 11-16 → 11-17, not 11-05
  assert.equal(nextAfter({ every: 2, unit: 'day', start: '2026-11-03' }, '2026-11-16'), '2026-11-17');
});
test('nextAfter before start is start', () => {
  assert.equal(nextAfter({ every: 1, unit: 'week', start: '2026-12-01' }, '2026-11-16'), '2026-12-01');
});
test('firstOnOrAfter includes today when today is an occurrence', () => {
  assert.equal(firstOnOrAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-17'), '2026-11-17');
  assert.equal(firstOnOrAfter({ every: 2, unit: 'day', start: '2026-11-01' }, '2026-11-16'), '2026-11-17');
});
test('month and year boundaries', () => {
  assert.equal(nextAfter({ every: 1, unit: 'day', start: '2026-01-01' }, '2026-12-31'), '2027-01-01');
});
test('parseSchedule rejects bad input', () => {
  assert.equal(typeof parseSchedule({ every: 0, unit: 'day', start: '2026-11-01' }), 'string');
  assert.equal(typeof parseSchedule({ every: 1, unit: 'month', start: '2026-11-01' }), 'string');
  assert.equal(typeof parseSchedule({ every: 1, unit: 'day', start: '2026-02-30' }), 'string');
  assert.deepEqual(parseSchedule({ every: 2, unit: 'week', start: '2026-11-02' }), { every: 2, unit: 'week', start: '2026-11-02' });
});
```

- [ ] **Step 2: Run** `node --test server/schedule.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `server/schedule.ts`. Do date arithmetic on UTC-midnight `Date.parse(day + 'T00:00:00Z')` / 86 400 000 day numbers so there is no local-timezone dependence; `tokyoDay` = `new Date(at + 9h).toISOString().slice(0, 10)`.
- [ ] **Step 4: Run** `node --test server/schedule.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(wallboard): chore schedule math`

---

### Task 2: State — chores with schedules, the event log, balances, view (`server/state.ts`)

**Files:**
- Modify: `wallboard/server/state.ts` (rewrite the chore half; panels unchanged)
- Test: `wallboard/server/state.test.ts` (replace the chore tests; keep panel/parse tests updated to the new shapes)

**Interfaces:**
- Consumes: Task 1's `Schedule`, `tokyoDay`, `nextAfter`, `firstOnOrAfter`, `parseSchedule`.
- Produces (exact):

```ts
export interface ChoreDef { id: string; title: string; who: string | null; icon: string | null; amount: number; schedule: Schedule }
export interface Chore extends ChoreDef {
  nextDue: string;            // shown as to-do when nextDue <= today
  doneOn: string | null;      // shown as done when doneOn === today
  prevDue: string | null;     // nextDue before today's tick, for undo
  doneEvent: string | null;   // id of today's 'done' event, for undo
}
interface Base { id: string; seq: number; at: number; who: string; delta: number }   // delta: signed change to what is owed
export type LogEvent =
  | (Base & { type: 'done'; choreId: string; title: string; amount: number })            // delta = +amount
  | (Base & { type: 'undone'; cancels: string; choreId: string | null; title: string | null }) // delta = -(cancelled.delta)
  | (Base & { type: 'payment'; amount: number; source: 'board' | 'eva'; note: string | null }); // delta = -amount
export interface BoardState { version: number; logId: string; seq: number; chores: Chore[]; log: LogEvent[]; panels: Record<string, Panel> }
export type Action =
  | { type: 'chore.set'; id: string; done: boolean; at: number; eventId: string }
  | { type: 'chores.replace'; chores: ChoreDef[]; at: number }
  | { type: 'payment'; eventId: string; who: string; amount: number; source: 'board' | 'eva'; note: string | null; at: number }
  | { type: 'cancel'; eventId: string; cancels: string; at: number }      // payments only
  | { type: 'panel.set'; name: string; data: unknown; at: number }
  | { type: 'panel.clear'; name: string };
export function emptyState(logId: string): BoardState;
export function apply(s: BoardState, a: Action): BoardState | null;
export function parseChores(body: unknown): ChoreDef[] | string;          // rejects `done`
export function reviveState(raw: unknown, newLogId: string): BoardState;
export interface Balance { earned: number; paid: number; owed: number; lastPaidAt: number | null }
export function balances(s: BoardState): Record<string, Balance>;
export interface ViewChore { id: string; title: string; who: string | null; icon: string | null; amount: number; done: boolean }
export function view(s: BoardState, at: number): { version: number; chores: ViewChore[]; balances: Record<string, Balance>; panels: Record<string, Panel> };
export function activityAfter(s: BoardState, after: number): { logId: string; seq: number; events: LogEvent[] };
```

Rules (from the spec, the ones tests pin):
- `chore.set done:true` applies only when `nextDue <= today` and `doneOn !== today`: sets `prevDue = nextDue`, `nextDue = nextAfter(schedule, today)`, `doneOn = today`, `doneEvent = eventId`, appends `done` with the chore's current `amount`. Otherwise `null`.
- `chore.set done:false` applies only when `doneOn === today`: restores `nextDue = prevDue`, clears `doneOn/prevDue/doneEvent`, appends `undone` cancelling `doneEvent`. Otherwise `null`.
- `chores.replace`: new id → `nextDue = schedule.start`, runtime fields null. Surviving id keeps runtime fields; if its `schedule` changed (deep compare), `nextDue = firstOnOrAfter(newSchedule, today)` unless it is done today (then `prevDue` is re-anchored the same way and `nextDue = nextAfter(newSchedule, today)`). Removed ids disappear from `chores` (their log events stay). Order = pushed order.
- `payment`: `null` if `eventId` already in the log (idempotent). `amount` is any non-zero integer (negative = opening-balance credit).
- `cancel`: only a `payment` not already cancelled; appends `undone` with `choreId/title` null; else `null`.
- Every appended event takes `seq = s.seq + 1`; every non-null result bumps `version`.
- `balances`: cancelled = set of `undone.cancels`. Per `who`: earned = Σ uncancelled `done.amount`, paid = Σ uncancelled `payment.amount`, owed = earned − paid (equals Σ all `delta`), lastPaidAt = latest uncancelled payment with amount > 0.
- `view`: chores where `nextDue <= today` (done:false) or `doneOn === today` (done:true), in state order.
- `reviveState`: missing `logId` → `newLogId`; missing `log`/`seq` → `[]`/max seq in log or 0; chores without a valid `schedule` are dropped (Notion re-pushes them); panels kept.

- [ ] **Step 1: Write the failing tests.** A fixture `const D = (iso: string) => Date.parse(iso + 'T03:00:00Z')` (noon Tokyo) and a two-chore state (`dishes` daily from `2026-11-16` ¥100 mariko; `bath` every 2 days from `2026-11-15` ¥100 sarina). Tests:
  - `tick records a done event worth the chore's amount and hides nothing until midnight` — set dishes done at `D('2026-11-16')`: log has one `done` {seq 1, delta 100, amount 100}; `view(s, D('2026-11-16'))` shows dishes `done: true`; `view(s, D('2026-11-17'))` shows dishes `done: false` (due again).
  - `bath not due on its off day` — `view` at `D('2026-11-16')` has no `bath`.
  - `undo the same day appends undone and restores due` — tick then untick: log types `['done','undone']`, `undone.cancels === done.id`, `undone.delta === -100`, `balances(s).mariko.owed === 0`, dishes shown to-do.
  - `undo after midnight is a no-op` — tick at `D('2026-11-16')`, untick at `D('2026-11-17')` returns `null`.
  - `ticking a chore not due is a no-op` — bath at `D('2026-11-16')` → `null`.
  - `amount is snapshotted` — tick, then `chores.replace` with amount 200, then `balances().mariko.earned === 100`.
  - `payment is idempotent on its id` — same `payment` twice → second returns `null`; owed reflects one.
  - `cancel only cancels a payment, once` — cancel a `done` id → `null`; cancel a payment → owed restored; cancel again → `null`.
  - `replace keeps progress; a changed schedule re-anchors` — tick dishes, replace with dishes `every: 2` → still `doneOn` today; a new chore gets `nextDue = start` even when start is in the past (overdue shows).
  - `parseChores rejects done and bad schedules` — `{chores:[{...valid, done:true}]}` → error mentioning `done`; amount `-1` or `1.5` → error; missing schedule → error.
  - `activityAfter returns events after a seq` — 3 events, `activityAfter(s, 1).events.map(e => e.seq)` → `[2, 3]`, plus `logId` and `seq: 3`.
  - `reviveState upgrades an old file` — `reviveState({version: 7, chores: [{id:'x',title:'X',who:null,icon:null,done:true,doneAt:1}], panels:{eva:{data:'hi',updatedAt:1}}}, 'log-new')` → `logId 'log-new'`, `chores []`, `log []`, `seq 0`, panel kept, version 7.
  - Keep the existing panel tests (with `emptyState('log-t')`).
- [ ] **Step 2: Run** `node --test server/state.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the interfaces above in `server/state.ts`. Keep the file header comment, updated: the board owns activity, Notion (via hermes) owns definitions.
- [ ] **Step 4: Run** `node --test server/` and `npm run typecheck` — expect PASS (index.ts will fail typecheck until Task 3; if so, run Task 3 before committing both, or stub-compile — implementer's choice, but commit only green).
- [ ] **Step 5: Commit** `feat(wallboard): chore schedules, event log and balances in board state`

---

### Task 3: Server routes and the midnight tick (`server/index.ts`)

**Files:**
- Modify: `wallboard/server/index.ts`
- Modify: `wallboard/scripts/seed.ts` (push the new chore shape: amount 100, daily schedule from today)

**Interfaces:**
- Consumes: Task 2 exports.
- Produces (HTTP):
  - Board (cookie): SSE `state` and `GET /api/state` now send `view(state, Date.now())`. `PUT /api/chores/<id>` `{done}` unchanged for the client; server mints the event id. `POST /api/pay/<who>` `{amount}` → `{ok, id}`. `POST /api/cancel/<eventId>` → `{ok}` (404 if not a cancellable payment).
  - hermes (bearer): `GET /api/eva/state` → `view(...)` (keeps `eva_bubble.py read` working). `PUT /api/eva/chores` `{chores: ChoreDef[]}` (no `ifVersion` any more). `GET /api/eva/activity?after=<seq>` → `activityAfter`. `GET /api/eva/balances` → `{balances}`. `POST /api/eva/payments` `{who, amount, note?, id?}` → `{ok, id, duplicate}`.
  - `newId(prefix: 'ev' | 'log'): string` = `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}` (local to index.ts). Valid for `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.

- [ ] **Step 1:** Wire `emptyState(newId('log'))` and `reviveState(raw, newId('log'))` at startup.
- [ ] **Step 2:** Change `broadcast`/`/api/state`/`/api/eva/state` to send `view(state, Date.now())`.
- [ ] **Step 3:** Add a 60 s `setInterval` that rebroadcasts when `tokyoDay(Date.now())` differs from the last broadcast day (no state change, no save).
- [ ] **Step 4:** Add the routes above. Validation: `who` must match `^[a-z][a-z0-9-]{0,31}$`; `amount` a non-zero integer (`POST /api/pay` additionally > 0); `note` string ≤ 200 or absent; a caller `id` must pass the event id regex. `chore.set` returning `null` → still 200 with current version (a repeated tap is not an error), 404 only for an unknown chore id. `payments` with a known `id` → 200 `{duplicate: true}`.
- [ ] **Step 5: Verify by hand** (no route tests exist in this project):

```bash
npm run dev &   # auth off when tokens unset
curl -s -X PUT localhost:8080/api/eva/chores -H 'content-type: application/json' \
  -d '{"chores":[{"id":"dishes","title":"Dishes","who":"mariko","icon":"dishes","amount":100,"schedule":{"every":1,"unit":"day","start":"2026-11-01"}}]}'
curl -s -X PUT localhost:8080/api/chores/dishes -H 'content-type: application/json' -d '{"done":true}'
curl -s localhost:8080/api/eva/activity?after=0      # one done event, delta 100
curl -s -X POST localhost:8080/api/eva/payments -H 'content-type: application/json' -d '{"id":"ev-test1","who":"mariko","amount":100}'
curl -s -X POST localhost:8080/api/eva/payments -H 'content-type: application/json' -d '{"id":"ev-test1","who":"mariko","amount":100}'   # duplicate: true
curl -s localhost:8080/api/eva/balances               # mariko owed 0
curl -s -X PUT localhost:8080/api/eva/chores -H 'content-type: application/json' -d '{"chores":[{"id":"x","title":"X","amount":100,"done":true,"schedule":{"every":1,"unit":"day","start":"2026-11-01"}}]}'   # 400 mentioning done
```

Delete `data/state.json` afterwards if the dev run created it.
- [ ] **Step 6:** `npm test && npm run typecheck` — PASS. **Commit** `feat(wallboard): activity, payments and balances API; view over SSE`

---

### Task 4: Pay in yen on the board (design → CLAUDE.md → web)

**Files:**
- Modify: `wallboard/design/ActivePaper.dc.html:276-282`, `wallboard/design/Active.dc.html:276-282` (the pay-row text logic only)
- Modify: `wallboard/CLAUDE.md:233` ("Pay" bullet), `wallboard/DESIGN.md` if it describes the pay row
- Modify: `wallboard/web/app.js` (`loadLocal`, `owedDays`, `days`, `payRow`, `pay`, the `case 'pay'` handler)

**Interfaces:**
- Consumes: `server.balances[who]: {earned, paid, owed, lastPaidAt}` from the view; `POST /api/pay/<who>` `{amount}` → `{id}`; `POST /api/cancel/<id>`.

Copy (exact):
- owed > 0: line 1 `¥{owed.toLocaleString('en-US')} to pay` in `--warm`, Mark paid button shown.
- owed ≤ 0: line 1 `Paid up` in `--success` if the girl has ever been paid, else `Nothing owed` in `--ink-muted`; no button.
- line 2: `Last paid {Mon 14 Nov}` (Tokyo date of `lastPaidAt`, weekday short + day + month short) or `Not paid yet`.
- Toast on Mark paid: title `Paid {Name} ¥{amount}`, sub `Eva will note it`, with Undo → `POST /api/cancel/<id>`.

- [ ] **Step 1:** Update both design files' pay-row logic to the copy above (sample state: owed in yen, `lastPaid` date) and the CLAUDE.md "Pay" bullet to: `Pay: "¥N to pay" (¥100 per chore, from the board's log) + Mark paid (amber) → "Paid up"; second line "Last paid <date>".`
- [ ] **Step 2:** In `web/app.js`: drop `owed`/`paidToday` from `local` (keep `bath`; `loadLocal` must still accept an old stored object). `payRow(g)` reads `server?.balances?.[g.id]` (absent → treat as owed 0, never paid). `pay(who)` POSTs the displayed `owed`, shows the toast with the returned id, and on failure shows the existing "Couldn’t save that" toast. Remove `owedDays`/`days` if unused.
- [ ] **Step 3: Verify:** `npm run dev`, push the Task 3 sample chore, open `http://localhost:8080/?mode=active&theme=day`, tick dishes → `¥100 to pay`; Mark paid → `Paid up` / `Last paid <today>`; Undo → back to `¥100 to pay`. Repeat with `?theme=evening`. `npm test` PASS.
- [ ] **Step 4: Commit** `feat(wallboard): pay in yen from the board's ledger`

---

### Task 5: `eva_chores.py` (the deterministic half of the skill)

**Files:**
- Create: `hermes/skills/eva-chores/scripts/eva_chores.py`
- Test: `hermes/skills/eva-chores/scripts/test_eva_chores.py`

**Interfaces:**
- Consumes: Task 3's hermes API. Env like `eva_bubble.py`: `WALLBOARD_TOKEN` (required), `WALLBOARD_URL` (default `https://eva-board.exe.xyz`). Reuse its `call()`/`die()` shape (copy, don't import).
- Produces (pure, tested):
  - `PEOPLE = {"mariko": "Mariko", "sarina": "Sarina", "nozomi": "Nozomi", "michael": "Michael"}`
  - `ledger_row(ev: dict, log_id: str) -> dict` with exactly these keys (Notion property names): `"Event id"`, `"Type"` (`done|undone|payment`), `"Who"` (display name), `"Chore"` (title or `""`), `"Chore id"` (or `""`), `"Amount ¥"` (= `ev["delta"]`, signed: Σ per girl = owed), `"At"` (ISO 8601 with `+09:00`), `"Cancels"` (or `""`), `"Source"` (`board|eva`, `""` for non-payments), `"Note"` (or `""`), `"Board log id"`.
  - `check(cursor: dict | None, resp: dict) -> dict | None` — alarm `{"kind": "log-replaced" | "seq-went-back", "expected": {...cursor}, "found": {"logId", "seq"}}` when `cursor` is set and `resp["logId"] != cursor["logId"]`, or `resp["seq"] < cursor["seq"]`. `None` cursor (first run) → no alarm.
  - `chore_defs(rows: list[dict]) -> list[dict] | str` — input rows use Notion property names `"Board id"`, `"Name"`, `"Who"`, `"Icon"`, `"Amount ¥"`, `"Every"`, `"Unit"`, `"Start"`, `"Active"`; keeps `Active` rows; maps `Who` display name → id via `PEOPLE` (case-insensitive); returns board `ChoreDef`s or the first error (`"Board id" missing`, amount not an integer ≥ 0, every < 1, unit not day/week, bad date, duplicate board id).
  - `new_chore_id(name: str, taken: set[str]) -> str` — `chore-<ascii slug>` (fallback `chore-<n>` for non-ASCII names), suffixed `-2`, `-3` until free.
- CLI (prints JSON on stdout, errors on stderr with exit 1):
  - `activity [--log-id ID --after SEQ]` → `{"alarm": ..., "rows": [...], "cursor": {"logId", "seq"}}`; on alarm `rows` is `[]` and `cursor` is the *old* one.
  - `push-chores` (JSON array on stdin) → `{"ok": true, "count": N}`.
  - `balances` → `{"mariko": {"owed": 700, "earned": ..., "paid": ..., "lastPaid": "2026-11-14"}, ...}` and a human line on stderr.
  - `pay WHO AMOUNT [--note TEXT] [--id ID]` → `{"ok": true, "id": ..., "duplicate": bool}`.
  - `new-chore-id NAME [--taken ID ...]` → the id.

- [ ] **Step 1: Write the failing tests** (`unittest`, no network):
  - `test_done_row` — event `{id:'ev-1', seq:1, at:<ms for 2026-11-16 12:00 JST>, who:'mariko', delta:100, type:'done', choreId:'dishes', title:'Dishes', amount:100}` → `"Amount ¥": 100`, `"Who": "Mariko"`, `"At": "2026-11-16T12:00:00+09:00"`, `"Board log id": "log-a"`.
  - `test_payment_row_is_negative` — payment amount 500 delta -500 → `"Amount ¥": -500`, `"Source": "board"`.
  - `test_undone_row_cancels` — `"Cancels": "ev-1"`, `"Amount ¥": -100`.
  - `test_check_first_run_no_alarm`, `test_check_log_replaced`, `test_check_seq_went_back`, `test_check_same_log_ahead_ok`.
  - `test_chore_defs_maps_and_filters_inactive`, `test_chore_defs_rejects_fractional_amount`, `test_chore_defs_rejects_duplicate_ids`, `test_chore_defs_unknown_who_is_error`.
  - `test_new_chore_id_slug_and_suffix` — `new_chore_id("Wash the dishes", {"chore-wash-the-dishes"}) == "chore-wash-the-dishes-2"`; `new_chore_id("お皿", set()) == "chore-1"`.
- [ ] **Step 2: Run** `cd hermes/skills/eva-chores/scripts && python3 -m unittest -q test_eva_chores` — FAIL.
- [ ] **Step 3: Implement** the script; module docstring lists commands like `eva_bubble.py`'s.
- [ ] **Step 4: Run** the unit tests — PASS. Then against `npm run dev` (Task 3 sample data): `WALLBOARD_URL=http://localhost:8080 WALLBOARD_TOKEN=x python3 eva_chores.py activity`, `... pay mariko 100 --id ev-dup`, twice (second `duplicate: true`), `... balances`.
- [ ] **Step 5: Commit** `feat(hermes): eva-chores script — board activity to ledger rows`

---

### Task 6: `SKILL.md` — what hermes does

**Files:**
- Create: `hermes/skills/eva-chores/SKILL.md`
- Modify: `hermes/README.md` (one line listing the skill)

Front matter `name: eva-chores`, `description:` covering: the scheduled chores sync; anyone asking about chores, allowance, pocket money or paying the girls; Michael asking to add/change/retire a chore or change an amount. Sections, each naming the exact script command and MCP action:

1. **The family and the money** — Mariko (11) and Sarina (8) do chores; each chore earns its amount (¥100 today); the board shows "¥N to pay".
2. **Who owns what** — Notion owns chore definitions; the board owns activity; therefore never edit/delete Ledger rows, never fix activity in Notion, never compose an amount, always copy the script's rows verbatim, never hand-write HTTP.
3. **One-time setup** — create page "Chores & allowance" with databases **Chores** (`Name` title, `Board id` text, `Who` select Mariko/Sarina, `Icon` select [the chore icon keys: dishes, clear-table, tub-clean, vacuum, dust, garbage, windows, living-room, toilet, bed, bag, table, shoes, laundry, plants], `Amount ¥` number, `Every` number, `Unit` select day/week, `Start` date, `Active` checkbox), **Ledger** (`Event id` title, `Type` select, `Who` select, `Chore` text, `Chore id` text, `Amount ¥` number, `At` date, `Cancels` text, `Source` select, `Note` text, `Board log id` text; views "Mariko" and "Sarina" filtered by Who, grouped by month, showing the `Amount ¥` sum = owed), **Settings** (one row: `Name` title "Settings", `Default amount ¥` 100, `Board log id` text, `Last seq` number, `Alarm` text, `Alarm at` date).
4. **The scheduled sync** — the five steps from the spec (push definitions → read cursor from Settings → `activity --log-id … --after …` → for each row, query Ledger by `Event id`, create if absent → write cursor only after all rows). Empty cursor on first run: omit the flags.
5. **The one alarm** — if `alarm` is set: stop copying; if Settings `Alarm` is empty or differs, write the alarm JSON + time there and create one Todoist task "Chores ledger: the board lost history — check Notion" priority p1, due today, with the Settings page link; if it is already recorded, do nothing more. Never repair. When Michael clears `Alarm` and resets the cursor, the next sync resumes.
6. **Changing chores** — write Notion first; new chore: `new-chore-id` (pass existing Board ids with `--taken`), `Amount ¥` from Settings unless told; retire = untick `Active` (never delete); then re-read Chores and `push-chores`. If push fails, say so plainly.
7. **Payments told to Eva** — `pay WHO AMOUNT --note "<what they said>"`, then run the sync. Opening balance or correction: negative amount = credit, with a note.
8. **Answering** — `balances`, one sentence in yen ("Sarina has ¥700 coming; she was last paid on Friday").

- [ ] **Step 1:** Write `SKILL.md` per the above (style: `eva-board-bubble/SKILL.md`).
- [ ] **Step 2: Verify:** every command named in SKILL.md exists in `eva_chores.py --help`; every Notion property name in SKILL.md matches `ledger_row`/`chore_defs` keys exactly (`grep -o '"[A-Z][^"]*"' eva_chores.py | sort -u` vs. the SKILL.md list).
- [ ] **Step 3: Commit** `feat(hermes): eva-chores skill instructions`

---

### Task 7: Export the current chores from Reminders (migration helper)

**Files:**
- Create: `wallboard/scripts/export-chores.py`

**Interfaces:**
- Self-contained (Task 8 deletes `sync/`): copy into it the `login()` from `scripts/probe-reminders.py`, the reading half of `Reminders.fetch()` from `sync/reminders_sync.py`, and `Item`, `NAMES`, `ICONS`, `parse_title`, `guess_icon`, `due_day` from `sync/chores.py`. Import nothing from `sync/`.
- Produces: stdout JSON array of rows in Task 5's Chores property names (`Name`, `Who`, `Icon`, `Amount ¥: 100`, `Every`, `Unit`, `Start` = current due day, `Active: true`, `Board id` = `new_chore_id`-style slug), ready for hermes to enter into Notion. Reminders with `freq` monthly/yearly or no due date are listed on stderr as "needs a decision", not exported.

- [ ] **Step 1:** Write the script (uv inline deps like `probe-reminders.py`); read-only — it must not write to Reminders.
- [ ] **Step 2: Verify** syntax only: `python3 -m py_compile wallboard/scripts/export-chores.py`. (Running it needs Michael's iCloud session; that happens at switchover.)
- [ ] **Step 3: Commit** `chore(wallboard): export current chores from Reminders for the Notion migration`

---

### Task 8: Retire the Reminders sync

**Files:**
- Delete: `wallboard/sync/` (all), `wallboard/deploy/wallboard-reminders.service`, `wallboard/scripts/probe-reminder-tick.py`
- Keep until switchover is done: `scripts/probe-reminders.py` and `scripts/export-chores.py` (self-contained since Task 7).
- Modify: `wallboard/package.json` (drop `test:sync` and its use in `test`), `wallboard/deploy/deploy.sh` (replace the Reminders block with: `sudo systemctl disable --now wallboard-reminders 2>/dev/null || true; sudo rm -f /etc/systemd/system/wallboard-reminders.service`), `wallboard/README.md` (rewrite "Chores": board schedule + log, hermes `eva-chores`, Notion; update the push-API table with the new endpoints and the `ChoreDef` shape; remove the iCloud login section for Reminders — keep the photos section), `CLAUDE.md` at the repo root only if it mentions Reminders (it doesn't today — check).
- Remove the `chores-sync` panel handling in `web/app.js` if any (`grep -n chores-sync web/`).

- [ ] **Step 1:** Make the changes above.
- [ ] **Step 2: Verify:** `grep -rn "reminders\|test:sync\|chores-sync" wallboard --exclude-dir=node_modules --exclude-dir=design -i` shows only README history/photos context and `export-chores.py`; `npm test && npm run typecheck` PASS; `python3 -m py_compile scripts/export-chores.py`.
- [ ] **Step 3: Commit** `chore(wallboard): retire the Apple Reminders chore sync`

---

### Switchover (Michael + hermes; not a coding task — do not run without Michael)

1. Run `uv run scripts/export-chores.py > chores.json` on the Mac (iCloud session still valid).
2. Install `eva-chores` on hermes; have hermes run the one-time setup and enter `chores.json` into the Chores db.
3. `npm run deploy` (stops the Reminders unit; the board starts with an empty chore list and a fresh log).
4. Ask hermes to run the sync once; check the board shows today's chores; tick and untick one; run the sync again and check two Ledger rows with Amount ¥ +100 and −100.
5. Add the cron job on hermes (every 15 min).
6. Opening balances, if any: tell Eva ("Mariko is owed ¥300 from before"), which records a credit via `pay mariko -300 --note …`.
