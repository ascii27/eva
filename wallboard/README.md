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
pins a view, `?theme=day|evening` pins a theme, `?debug=1` shows Silk's real viewport size and
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
| `PUT` | `/api/eva/chores` | `{"chores": [{"id", "title", "who"?, "icon"?}]}` | Replace the chore list. Chores that keep their `id` keep their done state. `who` is a household id (`mariko`, `sarina`, …); `icon` is a key in `web/icons.js` (`bed`, `bag`, `table`, `shoes`, `laundry`, `plants`). |
| `GET` | `/api/eva/state` | — | Read everything, including what the family ticked. |

**Absent vs empty**, as on the desk: a panel that was never pushed means "Eva
never told us" and the board shouldn't pretend it knows. A panel pushed as `[]`
means "there is nothing". Only `DELETE` makes a panel absent again.

Panels the board knows (shapes in `web/dummy.js`): `note` (`{text, sub?}` or a
string), `weather`, `leave-by`, `pickup`, `dinner`, `countdowns`, `schedule`,
`tomorrow`, `memories`.

`weather` is the exception: the server fills it itself from Open-Meteo (no key)
for Ikejiri, Setagaya every 15 min (`server/weather.ts`), so a push to it is
overwritten on the next poll. `WEATHER_LAT`/`WEATHER_LON` move it, `WEATHER=off`
stops polling.

`occasion` is the server's too: the countdown tile's default when nothing has
pushed `countdowns` — the nearest birthday in the calendar or major JP/US holiday
(`server/occasions.ts`). A pushed `countdowns` panel takes over the tile.
Each countdown is `{id, label, date, kind?, headline?, who?}` (`date` is
`YYYY-MM-DD`; a bare `days` number also works). The tile shows the nearest one
and drops past ones. `kind` is `visit` (default), `birthday` or `holiday` and
picks the tap celebration; `headline` is the first line when tapped (e.g.
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
both girls). All-day events arrive as `{at: null, allDay: true}`.

## Board API (enrolled cookie)

- `GET /api/events` — SSE: `hello {build}` then `state` on connect and on every change.
  A new `build` means a redeploy, and the page reloads.
- `PUT /api/chores/<id>` `{"done": true|false}` — a set, not a toggle, so undo
  and retries can't flip a chore the wrong way.

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
