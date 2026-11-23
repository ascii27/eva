# Eva wallboard

An always-on kitchen board for the family, shown full-screen on an Echo Show 15
in Silk. Mostly current information, plus touch updates (chores). Eva (hermes)
drives what's on it.

Separate from the phone app: its own Node project, its own deploy, hosted at
`https://eva-board.exe.xyz/`.

## Shape

- `server/state.ts`, `server/schedule.ts` — the board's state, each chore's
  schedule, the append-only activity log, and every way they change. Pure, tested.
- `server/index.ts` — Node `http`, no framework, no runtime deps. Holds state in
  one JSON file (`data/state.json`, atomic writes) and streams every change to
  open boards over SSE.
- `web/` — the single-page app, a port of `design/*.dc.html` (notes in
  `DESIGN.md`). A 1080-tall stage stretched to the screen's shape; three views:
  ambient (default), active (after a tap, back to resting after 60 s), night
  (22:00–06:00, tap for a dimmed active view). Two colour themes by time of
  day: "Morning paper" 06:00–21:00, dark Haven Night until 22:00, switched
  with a 1.5 s crossfade, no reload.
- `web/dummy.js` — **dummy content** for everything Eva doesn't push yet. Each
  key is replaced by the pushed panel of the same name. Bath order lives
  only in the board's browser (localStorage) and alternates nightly
  (`web/bath.js`). Pay is real:
  it comes from the board's activity log.

Node 24 runs the TypeScript directly (type stripping), so there is no build step.

```bash
npm install          # dev deps only (typescript, @types/node)
npm run dev          # http://localhost:8080, auth off when tokens are unset
npm test             # node:test
npm run typecheck
npm run deploy       # rsync to the VM, restart; open boards reload themselves
npm run seed         # push the dummy chore list (WALLBOARD_URL, HERMES_TOKEN);
                     #   add `-- --clear-panels` to fall back to dummy content
```

Testing switches on the board URL: `?time=7:42` fakes the clock, `?mode=ambient|active|night`
pins a view, `?theme=day|evening` pins a theme, `?eva=new` replays Eva's new-message arrival, `?sound=off` mutes the countdown chimes and
`?sound=announce|alarm` plays one on every tap, `?debug=1` shows Silk's real viewport size and
keep-alive status (and exposes `wb.nextPhoto()` and `wb.chime('announce'|'alarm')` in the console).

## Why hermes pushes and the board never pulls

On the desk, polling hermes for a context bundle was measured at ~325k tokens and
up to 88s per fetch — every request is a full agent run. So the board keeps its
own state and hermes **pushes** when something changes. Touch updates are local
and instant, and keep working when hermes is busy or down.

## Auth

The exe.dev proxy for this VM is **public**, so the app gates itself:

| Who | Credential | How |
|---|---|---|
| The Echo Show | `BOARD_TOKEN` | Open `https://eva-board.exe.xyz/?key=<BOARD_TOKEN>` once. It sets a 10-year cookie and redirects to `/`. |
| hermes | `HERMES_TOKEN` | `Authorization: Bearer <HERMES_TOKEN>` on `/api/eva/*`. |

Both are generated into `/etc/wallboard.env` on the first deploy:
`ssh eva-board.exe.xyz sudo cat /etc/wallboard.env`.

## Push API (hermes)

| Method | Path | Body | Effect |
|---|---|---|---|
| `PUT` | `/api/eva/panels/<name>` | `{"data": <any JSON>}` | Set a panel. `name` matches `^[a-z][a-z0-9-]{0,31}$`. |
| `DELETE` | `/api/eva/panels/<name>` | — | Remove a panel. |
| `PUT` | `/api/eva/chores` | `{"chores": [{"id", "title", "who", "icon", "amount", "schedule": {"every", "unit": "day"\|"week", "start"}}]}` | Replace the chore definitions (a `ChoreDef`). `amount` is yen per completion. Rejects `done`: that is the board's, not hermes'. Owned by the `eva-chores` skill (see "Chores"). `who` is a household id (`mariko`, `sarina`, …); `icon` is a key in `web/icons.js`. |
| `GET` | `/api/eva/state` | — | The computed view: `{version, chores: [{id, title, who, icon, amount, done}], balances, panels}`. |
| `GET` | `/api/eva/activity?after=<seq>` | — | `{logId, seq, events}`: log events with `seq` greater than `after`, in order, plus the log's id and its highest `seq` so hermes can spot a reset board. |
| `GET` | `/api/eva/balances` | — | `{balances: {who: {earned, paid, owed, lastPaidAt}}}`, computed from the log. |
| `POST` | `/api/eva/payments` | `{"who", "amount", "note"?, "id"?}` | Record a payment (a negative amount is a credit). `amount` is a non-zero integer within ±1,000,000 yen. A repeated `id` is not recorded twice. |
| `GET` | `/api/eva/plans` | — | `{plans: [Plan]}`: the family's calendar requests, pending first (oldest request first). A `Plan` is `{id, title, url, day, time?, until?, venue?, place?, want: "add"\|"remove", status: "pending"\|"done"\|"failed", note?, ref?, requestedAt, updatedAt}` (`server/plans.ts`). |
| `PUT` | `/api/eva/plans/<id>` | `{"want", "result": "done"\|"failed", "note"?, "ref"?}` | Report what you did for the `want` you read. `ref` is your calendar entry's id (kept for a later remove). A failure needs a `note` (≤200 chars, shown on the board). A done remove deletes the plan. `409` when the family changed the plan since you read it: read again. A repeated report is `{duplicate: true}`. |

**Absent vs empty**, as on the desk: a panel that was never pushed means "Eva
never told us" and the board shouldn't pretend it knows. A panel pushed as `[]`
means "there is nothing". Only `DELETE` makes a panel absent again.

Panels the board knows (shapes in `web/dummy.js`): `eva` (Eva's bubble, below),
`weather`, `leave-by`, `pickup`, `dinner`, `countdowns`, `schedule`,
`tomorrow`, `memories`.

`eva` is Eva's speech bubble: `{text, sub?, mood?: "happy" | "excited", at?}`
(a bare string also works). Keep `text` to ~90 characters (two lines, then
ellipsis) and `sub` to ~60 (one line); emoji are stripped. A push whose text,
sub or `at` differs plays the arrival (old bubble fades, Eva hops, the new one
pops in); re-pushing the same message does nothing. Unlike the other panels it
has **no dummy fallback**: absent means she has nothing to say, so there is no
bubble, only Eva peeking. The old `note` panel is still read when `eva` is
absent. `?eva=new` on the board replays the arrival (with a sample message if
nothing was pushed). Design and motion: `CLAUDE.md` "Eva bubble".

`weather` is the exception: the server fills it itself from Open-Meteo (no key)
for Ikejiri, Setagaya every 15 min (`server/weather.ts`), so a push to it is
overwritten on the next poll. `WEATHER_LAT`/`WEATHER_LON` move it, `WEATHER=off`
stops polling.

`occasions` is the server's too: the nearest birthday in the calendar, the
nearest major JP/US holiday and the nearest school event in the calendar, if
any (`server/occasions.ts`). The countdown tile ("Coming up") rotates through
those **and** whatever Eva pushed in `countdowns`, nearest first, one every 20 s;
a pushed countdown on the same day as a default, with the same `kind` or
`label`, replaces it. An empty `countdowns` push just means Eva has nothing to
add. Each countdown is `{id, label, date, kind?, headline?, who?}` (`date` is
`YYYY-MM-DD`; a bare `days` number also works). Past ones are dropped. `kind` picks the tile's icon, colour and tap celebration —
one of `holiday`, `visit`, `birthday`, `trip`, `move`, `anniversary`, `recital`,
`sports`, `ceremony`, `school`, `new-year`, `setsubun`, `hinamatsuri`, `hanami`,
`kodomo`, `tanabata`, `obon`, `tsukimi`, `valentine`, `easter`, `parents-day`,
`july4`, `halloween`, `thanksgiving`, `christmas`, `summer`, `autumn`, `winter`,
`spring` (table in `CLAUDE.md` "Countdown kinds"). No `kind` means `visit`; an
unknown one falls back to `holiday` (star, confetti). The server's default
gives each built-in holiday its own kind. `headline` is the first line when tapped (e.g.
"Grandma comes", "Sarina turns 9"; defaults to `label`); `who` colours a
birthday tile.

`schedule`, `tomorrow`, `leave-by` and `bedtime` are the server's too: the fixed routine
(`server/routine.ts` — weekday 7:55 school run, bedtime 20:30 / 21:00 Fri–Sat,
also published as `bedtime` for its 30-min countdown card)
merged with the family's iCloud calendar when
`CALENDAR_URL` (the published `webcal://` link) is set in `/etc/wallboard.env`
(`server/calendar.ts`): fetched every 15 min, recomputed every minute so the day
rolls over at midnight, all times in Tokyo time. The link is a secret — anyone
holding it can read the calendar — so it lives only on the VM, never in git or
logs. `who` is everyone **invited** to the event (its attendees, minus the
organizer and anyone who declined), matched to the household by name or
address, plus anyone the title names (まりこ/さりな/のぞみ/マイケル or romaji;
キッズ = both girls). An invitee whose name and address don't say who they are
(a child's Apple ID) is mapped with `CALENDAR_PEOPLE="addr@example.com=sarina …"`
in `/etc/wallboard.env`; after each fetch the journal logs how many invitees
matched nobody (counts only, never names or addresses). `schedule` (today) and `tomorrow` are event lists:
`[{id, who, start, end?, title, icon, bring?: [{icon, label}]}]` — `start` is
`H:MM` (`null` with `allDay: true` for all-day events), `end` defaults to start
+ 60 min, `icon` is a key in `web/icons.js` (the server guesses it from the
title). Today's list carries bedtime as `id: "bedtime"`; tomorrow's carries the
school run as `School` at 7:55 and never bedtime. The board also still reads
the older `at` field and the old `tomorrow: {at, title}`.

`tokyo-events` is the server's too (ASC-35, `server/tokyoevents.ts`): what's on in
Tokyo, from Tokyo Cheapo. The **events** feed (`tokyocheapo.com/events/feed/`, one
item per event) finds them; the main feed is articles, not events. The feed has no
event dates, so each event's own page is read once for its schema.org `Event`
JSON-LD (dates, venue, prices, photo) and its map pin, and cached in
`data/tokyo-events.json` (re-read when the post is edited, or weekly while the event
is ahead). Each shown event's photo is downloaded once, resized to ≤1024 px and served
by the board itself from `data/event-photos/` (`/event-photos/<id>.jpg`, enrolled
cookie), so the Echo never loads a third-party image. Feed every 6 h;
`TOKYO_EVENTS=off` stops it.

Only events **for the family** and **nearby** are published:
- **Not adult.** Sexual and adults-only topics anywhere in the title, summary or
  opening paragraph, and drinking events by title (a craft-beer festival is out; a
  Christmas market that mentions mulled wine is in). `forFamily` has the lists.
- **In Tokyo, and within `EVENTS_MAX_KM` of home** (default 25, which keeps Sanrio
  Puroland at 23 km). Yokohama, Saitama and the rest are out however close.

The panel is every such event still on, soonest first: `[{id, title, url, start, end,
time?, until?, venue?, locality?, region?, km?, price?: {from, to}, free?, summary?,
about?, image?, weekend}]`. Dates are `YYYY-MM-DD`. `time`/`until` are `H:MM`, given only
when the page has a real time; for a multi-day event they're daily hours. `km` is
straight-line from home. `weekend` is true when it's on this coming Saturday or Sunday
(the current ones, at the weekend). `about` is the post's opening paragraph and
`image` is the board's copy. No `price` and no `free` means not listed: the site writes
¥0 both for free events and for unknown prices, so `free` is only set when the text
says so. Nothing is published until the first feed read succeeds, so absent means
"not known yet".

**On the board:** a "This weekend" card in the active view's right column, a detail
sheet per event, and a browse sheet (CLAUDE.md "What's on in Tokyo"). From the
detail sheet the family asks Eva to put an event on the family calendar, or take it
off. Those requests are **plans** (`server/plans.ts`), kept in the board's state.
hermes' `eva-events` skill reads them, edits the calendar with its own tools and
reports back (`hermes/skills/eva-events/`).

**The board wakes hermes; hermes doesn't poll** (`server/nudge.ts`). A hermes run
is a full agent run (~325k prompt tokens measured), so a schedule would spend that
every time it fired. Instead, about a minute after the last tap the board sends
hermes one chat message listing every pending plan and naming the skill. A plan
still pending 30 min later is sent again, at most 3 times in all; nothing is sent
while a request is in flight. Configured in `/etc/wallboard.env`:
`HERMES_AGENT_URL` (hermes' OpenAI-compatible base, e.g.
`https://orbit-python.exe.xyz/v1`), `HERMES_AGENT_KEY` (its `API_SERVER_KEY`: a
secret, never logged), optional `HERMES_AGENT_MODEL` (default `hermes-agent`).
Unset means nothing is sent, and the skill has to be scheduled instead. hermes' bubble skill reads
the weekend list to suggest one now and then.

## Board API (enrolled cookie)

- `GET /api/events` — SSE: `hello {build}` then `state` on connect and on every change.
  A new `build` means a redeploy, and the page reloads.
- `GET /api/state` — the same computed view hermes reads.
- `PUT /api/chores/<id>` `{"done": true|false}` — a set, not a toggle, so undo
  and retries can't flip a chore the wrong way.
- `POST /api/pay/<who>` `{"amount"}` — Mark paid: records a payment. `amount` must be
  positive and equal to what is currently owed; anything else (a double tap's second
  request, a balance that changed underneath) is `409 {error, owed}` and records nothing.
- `POST /api/cancel/<eventId>` — cancels a recorded payment (the undo of Mark paid).
  Completions are undone with `PUT /api/chores/<id>` instead; anything else is 404.
- `POST /api/plans/<eventId>` `{"want": "add", "day": "YYYY-MM-DD"}` or `{"want": "remove"}`:
  ask Eva to put a `tokyo-events` event on the family calendar on that day (one the
  event is on, not past), or take it off. Last tap wins; a different day for an
  added event is a move. `400` with the reason for a bad day, `404` for an unknown event.
- `GET /event-photos/<id>.jpg`: an event's photo (the panel's `image`).

## Chores

Chore definitions live in Notion and reach the board through hermes' `eva-chores`
skill (`hermes/skills/eva-chores/SKILL.md`, `scripts/eva_chores.py`), which
pushes `PUT /api/eva/chores`. Each chore carries its own schedule and its pay in
yen. The board, not hermes, decides what is due.

- **What shows:** chores due today, plus overdue ones, which carry over until
  done. Ticking moves a chore to its next occurrence after today; undo
  restores it, same day only. A new chore starts at its `start`, even if past;
  one dropped from a push and back in a later one is seeded from its last
  completion in the log, so it keeps its phase and can't be paid twice in a
  day. Policy and tests: `server/schedule.ts`, `server/state.ts`.
- **Every tap is an event** in the board's append-only log (`data/state.json`),
  with an event id, a `logId` and a monotonic `seq`. hermes reads
  `GET /api/eva/activity?after=<seq>` and copies new events into the Notion
  ledger, so a retry never duplicates a row.
- **Pay** is per chore, in yen. **Mark paid** records a payment in the same log,
  and balances (`earned`, `paid`, `owed`) are computed from it, never stored.
- **Icons** come from the chore definition; a chore with none gets the board's
  generic one.

**Migration.** The old Apple Reminders sync is gone. To export the current
#Chore reminders once, run on the Mac (iCloud login, password + 2FA, prompted
and never stored): `uv run scripts/export-chores.py > chores.json`.

## Memories (iCloud shared albums)

`ICLOUD_ALBUMS` in `/etc/wallboard.env` lists shared-album links (Public Website
on), comma or space separated. Never commit them: anyone with a link can view
that album.

The server keeps a small rotating set on disk (`PHOTO_TARGET`, default 50) in
`data/photos/`. Every hour, and on each restart, it swaps `PHOTO_SWAP` (default 10) for new
pseudo-random picks and drops anything removed from an album. Stills only (no
videos), pre-sized with `sharp` on the way in: upright per EXIF, landscape to
1920 wide, portrait to 1080 tall, JPEG 80. Apple's download links expire in ~20
minutes, which is why it keeps copies rather than linking. The feed is undocumented; what it relies on is written
down at the top of `server/photos.ts`.

The board shuffles that set (no repeats until each has shown once), crossfades
every 4 minutes, and gives each slide a barely visible zoom/pan. Portraits are
shown alone in the left half, never paired. A pushed
`memories` panel overrides all of it.
