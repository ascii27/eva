# Eva wallboard

An always-on kitchen board for the family, shown full-screen on an Echo Show 15
in Silk. Mostly current information, plus touch updates (chores). Eva (hermes)
drives what's on it.

Separate from the phone app: its own Node project, its own deploy, hosted at
`https://eva-board.exe.xyz/`.

## Shape

- `server/state.ts` — the board's state and every way it changes. Pure, tested.
- `server/index.ts` — Node `http`, no framework, no runtime deps. Holds state in
  one JSON file (`data/state.json`, atomic writes) and streams every change to
  open boards over SSE.
- `web/` — the single-page app, a port of `design/*.dc.html` (notes in
  `DESIGN.md`). A 1080-tall stage stretched to the screen's shape; three views:
  ambient (default), active (after a tap, back to resting after 60 s), night
  (21:30–06:30, tap for a dimmed active view). Two colour themes by time of
  day: "Morning paper" 06:30–21:00, dark Haven Night until bedtime, switched
  with a 1.5 s crossfade, no reload.
- `web/dummy.js` — **dummy content** for everything Eva doesn't push yet. Each
  key is replaced by the pushed panel of the same name. Pay and bath order are
  dummy too and live only in the board's browser (localStorage).

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
pins a view, `?theme=day|evening` pins a theme, `?eva=new` replays Eva's new-message arrival, `?debug=1` shows Silk's real viewport size and
keep-alive status (and exposes `wb.nextPhoto()` in the console).

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
| `PUT` | `/api/eva/chores` | `{"chores": [{"id", "title", "who"?, "icon"?, "done"?}], "ifVersion"?}` | Replace the chore list. Chores that keep their `id` keep their done state unless the push sends `done`. With `ifVersion`, 409 if the state moved on. The Reminders sync owns this list (see "Chores"). `who` is a household id (`mariko`, `sarina`, …); `icon` is a key in `web/icons.js` (`bed`, `bag`, `table`, `shoes`, `laundry`, `plants`). |
| `GET` | `/api/eva/state` | — | Read everything, including what the family ticked. |

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

`occasion` is the server's too: the countdown tile's default when nothing has
pushed `countdowns` — the nearest birthday in the calendar or major JP/US holiday
(`server/occasions.ts`). A pushed `countdowns` panel takes over the tile.
Each countdown is `{id, label, date, kind?, headline?, who?}` (`date` is
`YYYY-MM-DD`; a bare `days` number also works). The tile shows the nearest one
and drops past ones. `kind` picks the tile's icon, colour and tap celebration —
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
logs. `who` is read from the title (まりこ/さりな/のぞみ/マイケル or romaji; キッズ =
both girls). `schedule` (today) and `tomorrow` are event lists:
`[{id, who, start, end?, title, icon, bring?: [{icon, label}]}]` — `start` is
`H:MM` (`null` with `allDay: true` for all-day events), `end` defaults to start
+ 60 min, `icon` is a key in `web/icons.js` (the server guesses it from the
title). Today's list carries bedtime as `id: "bedtime"`; tomorrow's carries the
school run as `School` at 7:55 and never bedtime. The board also still reads
the older `at` field and the old `tomorrow: {at, title}`.

## Board API (enrolled cookie)

- `GET /api/events` — SSE: `hello {build}` then `state` on connect and on every change.
  A new `build` means a redeploy, and the page reloads.
- `PUT /api/chores/<id>` `{"done": true|false}` — a set, not a toggle, so undo
  and retries can't flip a chore the wrong way.

## Chores (Apple Reminders)

The chore list comes from the family's shared **Family** list in Apple
Reminders: every reminder tagged **#Chore**, titled `Chore - Name` (`Dishes -
Mariko`; the name after the last " - " becomes `who`, same spellings as the
calendar). `sync/reminders_sync.py` runs beside the board
(`wallboard-reminders.service`) and owns the chore list: it pushes
`PUT /api/eva/chores` with `done` and an `ifVersion`, so a tap made while it
was talking to iCloud is never overwritten (409, retried).

- **What shows:** chores due today or overdue (to do), and chores that were due
  today and have since moved on (done, until midnight). Policy and tests:
  `sync/chores.py`, `sync/test_chores.py` (`npm run test:sync`).
- **Ticking is what the iPhone does.** The chores repeat, and ticking a
  repeating reminder on a phone moves its due date to the next occurrence: no
  completed flag, no completed copy. A tap on the board does the same (past
  today, if it was overdue); Undo puts the old date back. A tick on a phone
  shows on the board within `ICLOUD_POLL` (120 s); a tap on the board reaches
  Reminders within a few seconds.
- **Icons** are guessed from the chore's name (`table`, `bath`, …); a chore
  with no icon of its own gets the board's generic one.

**Login.** No password lives on the VM. Log in on a Mac (password + 2FA,
prompted, never stored), then copy the session:

```bash
uv run scripts/probe-reminders.py    # in a real terminal, from wallboard/
scp -r ~/.wallboard-icloud eva-board.exe.xyz:
ssh eva-board.exe.xyz 'chmod -R go-rwx ~/.wallboard-icloud && sudo systemctl restart wallboard-reminders'
```

The session's file name stands in for the Apple ID, so the address isn't in
`/etc/wallboard.env` either. When Apple expires the session the sync stops
touching iCloud, keeps the last list on the board, logs "login needed", and
publishes the `chores-sync` panel as `{ok: false, reason: "login"}` (`{ok:
true}` otherwise) — repeat the three lines above. `scripts/probe-reminder-tick.py`
ticks or un-ticks one reminder titled "Test…" by hand.

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
