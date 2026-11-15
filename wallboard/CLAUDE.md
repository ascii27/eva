# CLAUDE.md — Eva wallboard

Guidance for any Claude session working in `wallboard/`. Read `README.md` (how it runs) and `DESIGN.md` (what it should look like and why) first.

## The rule: design first, then port
`web/` is a port of `design/*.dc.html`. Colours, sizes and spacing come from those files, copied exactly. Don't invent new values in `web/`. If something isn't specified there or in `DESIGN.md`, ask rather than guess. When the design changes, update `design/` and `DESIGN.md` together, then port.

## Which design files are current
| Use | File |
|---|---|
| Day calm view (06:30–21:00) | **"Morning paper v3 · halo"** — landscape photo: `design/PaperV3HaloLandscape.dc.html`; single portrait: `design/PaperV3Halo.dc.html` (same as `PaperPortraitSingle`) |
| Day active view | `design/ActivePaper.dc.html` |
| Day chore tap / undo states | `design/ChoreTapPaper.dc.html` |
| Day portrait photos | `design/PaperPortraitSingle.dc.html` (one portrait, left half) |
| Evening (21:00–bedtime) | `design/Main.dc.html` (dark; same icon strip and tap-to-celebrate tile as day, dark avatar colours), `design/Active.dc.html`, `design/ChoreTap.dc.html` |
| Night (bedtime–06:30) | `design/Night.dc.html` |
| **Reference only — do not port** | `LightPaper` (v1, too bright on the Echo), `PaperV2Cards`, `PaperPortraitPair` (pairing dropped), `LightDay`, `LightPastel`, `LightPhoto` |

## Day theme ("Morning paper v2 · sand")
Lives in `web/styles.css` under `.stage[data-theme="day"]`. Values come from the `:root` block of `PaperV2Sand.dc.html`:
- Ground `#d6c7ae`; cards `#fffaf1` with a 1px `#c9b89c` edge and a stronger shadow (`--elevation-1` in the design file). Every card gets the edge, not just some.
- Ink `#1d1712`, muted `#4b4034`, faint `#5f5345`.
- Teal `#0b6760` always means "done". Amber `#934606` is only for pay.
- The memory photo sits under a **35% sand veil** (`rgba(214, 199, 174, 0.35)`). The clock and weather sit directly on the photo, with no card. Keeping the photo visible matters to the family, so never cover the left side with a card.
- **Text on the photo (v3 halo).** Applies to every photo layout: landscape and single portrait. Every piece of text that sits on the photo (date, clock, weather, "Tap anywhere" hint) gets a cream halo and dark ink:
  - `text-shadow: 0 0 2px #fffaf1, 0 0 6px #fffaf1, 0 0 22px rgba(255, 250, 241, 0.95)`
  - Clock and temperature: weight 400 (not 300), colour `--ink`.
  - Date: weight 700, colour `--ink` (not muted).
  - Weather word: weight 600. Weather detail line: weight 500, colour `--ink`.
  - The memories caption goes on a small solid `--surface-100` pill, not on the photo.
  - Text on cards and on plain sand gets no halo; it's only for text over photos.
  - Why: on the Echo, thin black text over a real photo (dark hair, faces, bright colours) was unreadable (2026-11-15).
  - Silk cost: the halo's blur repaints only when the text changes (once a minute for the clock), which is fine. Don't animate it.
- Avatars: Mariko `#e7defa` with text `#4a3480`, Sarina `#fbdde6` with text `#8c2a4f`.
- Why v2: v1 looked too bright and flat on the Echo Show 15 (washed-out photos, cards that didn't stand out).

## Calm view: right column (2026-11-15)
- **No "Eva says" card on the calm view for now** (removed at the family's request). Leave the `note` panel in the data and the active view; just don't render it on calm.
- **"Later today" sits on a solid card** (`--surface-100`, 1px `--line` edge, `--elevation-1`), not on the photo. The halo did not read well for list text.
  - Calendar icon + "LATER TODAY" eyebrow.
  - Up to 3 rows: time 34 px (display font, muted), title 34 px weight 600, and on the right a 48 px avatar of who it's for (or a fork icon in a `--warm-soft` circle for dinner).
- The right column is now: leave-for-school card (only in its window), then "Later today".

## Calm view: big, icon-led signals (2026-11-15)
The calm view is read from 2–4 m, so it shows a few large signals, **icons first, words second**. Details live one tap away in the active view.
- Bottom strip is 168 px tall with four tiles (cards, no halo):
  - **Each girl:** an 84 px avatar with her name (22 px bold) under it, then **one 64 px circle per chore showing that chore's icon** (`web/icons.js`: bed, bag, table, shoes, laundry, plants).
    - Done: solid teal circle, white icon, small white check badge at the bottom-right.
    - To do: sand circle (`--surface-200`) with a 3 px `--line` ring and a dark icon.
    - All done: a 40 px teal star badge (with glow) on the avatar's top-right.
  - **Bath:** a 96 px bathtub icon in a `--cool-soft` circle, then the avatar of whoever goes first with a blue "1st" pill on it.
  - **Countdown:** a 96 px gift icon in a `--warm-soft` circle, the number at 88 px amber, "days · Grandma" at 22 px bold.
  - **Tap to celebrate:** the countdown tile is the one tile that does NOT open the active view. It sits above the tap-anywhere layer (z-index 3) and stops propagation. On tap, for 4 s:
    - The gift wiggles and its lid pops open.
    - ~16 confetti pieces (girls' colours, teal, amber, blue) burst up and fall out of the gift: one CSS keyframe using per-piece `--dx/--dy/--dx2/--dy2/--r` variables, 1.7 s.
    - The tile gets an amber ring; the icon circle shrinks 96 → 72 px so the text has room.
    - The text swaps to "Grandma comes / Sat 28 / 12 sleeps to go" (kids count sleeps) at 18 / 32 / 20 px. **All tile text must stay inside the tile**: single lines with ellipsis as a safety net; at rest the label goes on its own line under "days".
    - **The effect fills the whole screen**, not just the tile: a full-stage overlay (`pointer-events: none`, above everything) for ~4.8 s, on top of the small burst at the gift.
    - Then it returns (≈5 s). Tapping again restarts it.
    - With `prefers-reduced-motion`, the confetti and wiggle are skipped; the text swap stays.
    - Silk budget: transforms and opacity only, no blur, no canvas or JS animation loop. The confetti elements are removed after each burst.
    - **Per event kind** (reference: `design/EventTiles.dc.html`). Eva sets `kind` when she pushes a countdown; unknown kinds fall back to `visit`.
      - `visit`: gift icon, amber; lid pops, confetti bursts from the gift and ~38 pieces rain down across the whole screen.
      - `birthday`: cake icon, the birthday girl's colour; candle flickers, ~14 pastel balloons rise from the bottom edge across the whole screen (3–4 s).
      - `holiday`: snowflake icon, blue; ~34 blue flakes drift down across the whole screen (3.5–4.5 s).
      - Particle budget on Silk: ≤ 40 elements, transform + opacity only, removed when the effect ends.
      - Party text is always: what (e.g. "Sarina turns 9"), the day ("Sat 28"), "N sleeps to go".
      - Push shape: `countdowns: [{ id, label, date, kind, who?, headline? }]`. The calm tile shows the nearest one. `headline` is the party's first line ("Grandma comes"); without it the label is used.
- No counts, chore names, pay text or bath history on the calm view; those live in the active view.
- Every icon tile has an `aria-label` that says it in words (e.g. "Make bed: done").
- Rule of thumb: if it can't be read from across the kitchen, it belongs in the active view.

## Household and behaviour (don't regress)
- Only Mariko (11) and Sarina (8) have chores. Michael and Nozomi appear in the schedule only.
- Every chore tap answers instantly, with an 8 s Undo toast. Single taps only: no long-press, swipe or text entry.
- Pay: "N days to pay" + Mark paid (amber) → "Paid up". Bath order alternates nightly; Swap overrides tonight and counts as history.
- Photos: landscape fills the screen; a portrait goes in the left half with the right half plain. **One photo at a time — never pair portraits.**
- Leave-for-school is real now (`server/routine.ts`): 7:55 Mon–Fri, shown only in the 45 min before (DESIGN.md). Never in the evening, never at weekends.
- Bedtime 20:30 Sun–Thu, 21:00 Fri–Sat: a schedule row plus the countdown card in the 30 min before; night mode stays 21:30.
- Countdown tile defaults to the nearest calendar birthday or major JP/US holiday (`server/occasions.ts`, `occasion` panel); Eva's `countdowns` push overrides it. Tapping it celebrates as described above (particles copied into `web/celebrate.js`, `countTile()`/`celebrate()` in app.js).
- The page background is fully solid, so nothing from the Echo's own screen shows through.

## Silk constraints
Low-powered Chromium. CSS transitions only (theme switch is a 1.5 s crossfade on variables), no blur filters, no video, pre-sized images. Test with `?theme=day`, `?time=7:42`, `?mode=ambient|active|night`, `?debug=1`.
