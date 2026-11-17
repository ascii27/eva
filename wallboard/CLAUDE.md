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
| Calm right column through the day | `design/DayFlow.dc.html` (rules in "Calm view: right column changes through the day") |
| Countdown tile celebrations | `design/EventTiles.dc.html` |
| Eva bubble (character, placement, states) | `design/EvaCharacter`, `EvaOptA`, `EvaDayPortrait`, `EvaEvening`, `EvaNight`, `EvaActive`, `EvaStates` (`.dc.html`) |
| Weather card + icons | `design/WeatherIcons.dc.html` |
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

## Calm view: right column changes through the day (2026-11-15)
Purpose: **who has what today, so the family can prepare.** Reference: `design/DayFlow.dc.html` (three moments at real size, 744 px wide; sample schedule).
- **No "Eva says" card** on the calm view: Eva now appears as the Eva bubble (see "Eva bubble"), on the photo, not in the right column.
- Nothing in the right column sits on the photo without a card: everything is on solid cards (`--surface-100`, 1px `--line` edge, `--elevation-1`). No halo here.

**1. "Next up" card (top, only when something starts within 60 min)**
- Glow card (`--glow-accent`). Eyebrow with the event's icon + label ("Leave for school", or "Next up"), and avatars (44 px) of who's involved on the right.
- Big countdown: number at 104 px teal + "min", then the title ("by 7:55", "Swim").
- **Bring** row: amber pills (`--warm-soft` bg, `--warm` text, icon + word) from the event's `bring` list. Hide the row if it's empty.
- This replaces the old leave-for-school card and fixes its bug: the countdown is always to a real event time, never relative to "now".
- If two events start within the hour, show the sooner one.

**2. "Today" card (always, until the switch below)**
- Calendar/clock icon + "TODAY" eyebrow.
- One row per person who has something, in fixed order: Mariko, Sarina, Nozomi, Michael. 56 px avatar, then their items as pills (56 px tall, icon + time + title, 26 px).
  - Upcoming: `--surface-200` fill, 2px `--line` border, ink text.
  - Next (the "Next up" event, or the next item for that person within the hour): solid teal, white text.
  - Done (end time passed): transparent, 2px dashed `--line` border, faint text, small check. Done items stay so the day's shape is visible.
  - Nothing scheduled: **leave that person out entirely** (no row, no "Free"). If nobody has anything, show one muted line: "Nothing scheduled".
  - More than 3 items for one person: show the next 2 + a "+N more" pill; the full list is in the active view.

**3. After dinner: Tomorrow (plus the evening "Next up")**
- Switch when every item today is done, or at 18:30, whichever comes first. Night mode takes over at bedtime as before.
- Evening "Next up" is usually Bedtime, with the bath-order row inside it (see the space budget below).
- **Tomorrow · <weekday>** card: same per-person rows and pills as Today, for tomorrow. Footer row **Pack tonight** with amber pills (union of tomorrow's `bring` lists, deduplicated).

**Space budget — the right column must never run under the bottom strip** (seen on the Echo 2026-11-15: Bedtime + Tonight + Tomorrow overflowed)
- The calm stage is a fixed layout: top area above the strip, then the 168 px strip. Build it as a grid with the strip in its own row (`grid-template-rows: minmax(0, 1fr) 168px`) and give the right column `min-height: 0; overflow: hidden`, so content can only be trimmed, never overlap. At 1920×1080 the right column has ~740 px of height.
- **Weather card first, then at most 2 cards** in the right column: the "Next up" card (if any) + one list card (Today, or Tomorrow after the switch).
- **No separate "Tonight" card.** Bath order goes inside the evening "Next up" card (e.g. Bedtime) as a row: tub icon, "Bath first", avatar, name. If there's no Next-up card, put that row at the top of the Tomorrow card.
- **Compact list rules**, applied in this order until it fits:
  1. Merge people who share the same event (same title and time) into one row with overlapping avatars (e.g. Mariko + Sarina, 7:55 School).
  2. Max 2 pills per row + a "+N more" pill.
  3. If it still doesn't fit, drop rows from the bottom (latest first) and end with a "+N more" row. The active view always has everything.
- Test the worst case: `?time=20:21` with bedtime, bath and a full tomorrow; nothing may touch the strip.

**Data (from Eva; absent vs empty rules apply)**
- `schedule` (today) and `tomorrow`: `[{ id, who: ["mariko", ...], start: "HH:MM", end?: "HH:MM", title, icon, bring?: [{ icon, label }] }]`. `end` defaults to `start` + 60 min for the done state.
- Icons: `web/icons.js` already has bag, bath, calendar, moon and others; add swim, music, tooth, car (pickup), work, tennis, umbrella, towel, recorder, clock in the same line style (24 grid, 1.9 stroke, round caps).
- Weather can add a bring item (umbrella when rain is forecast before the event ends).

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
    - **Per event kind** (reference: `design/EventTiles.dc.html`). Eva sets `kind` when she pushes a countdown; unknown kinds fall back to `holiday` (star).
      - `visit`: gift icon, amber; lid pops, confetti bursts from the gift and ~38 pieces rain down across the whole screen.
      - `birthday`: cake icon, the birthday girl's colour; candle flickers, ~14 pastel balloons rise from the bottom edge across the whole screen (3–4 s).
      - `winter` (was `holiday`): snowflake icon, blue; ~34 blue flakes drift down across the whole screen (3.5–4.5 s). Full kind list: "Countdown kinds" below.
      - Particle budget on Silk: ≤ 40 elements, transform + opacity only, removed when the effect ends.
      - Party text is always: what (e.g. "Sarina turns 9"), the day ("Sat 28"), "N sleeps to go".
      - Push shape: `countdowns: [{ id, label, date, kind, who?, headline? }]`. The calm tile rotates through them with the server's defaults (see "Household and behaviour"). `headline` is the party's first line ("Grandma comes"); without it the label is used.
- No counts, chore names, pay text or bath history on the calm view; those live in the active view.
- Every icon tile has an `aria-label` that says it in words (e.g. "Make bed: done").
- Rule of thumb: if it can't be read from across the kitchen, it belongs in the active view.

## Chore icons (2026-11-15)
Reference: `design/ChoreIcons.dc.html` (each icon large, plus to-do and done states at strip size). Same line style as the board. Add to `web/icons.js` with these keys; `PUT /api/eva/chores` uses them in `icon`.

| key | Chore | Drawing |
|---|---|---|
| `dishes` | Wash the dishes | bowl with soap bubbles |
| `clear-table` | Clear the table | plate lifting off a table, up arrow |
| `tub-clean` | Clean the bathtub | bathtub + sparkle (distinct from `bath`, which means bath order) |
| `vacuum` | Vacuum | upright vacuum |
| `dust` | Dusting | feather duster |
| `garbage` | Take out the garbage | tied garbage bag |
| `windows` | Wash the windows | window + shine marks + sparkle |
| `living-room` | Tidy the living room | sofa + sparkle |
| `toilet` | Clean the toilet | toilet (side view) + sparkle |
| `bed`, `bag`, `table`, `shoes`, `laundry`, `plants` | existing | unchanged |

- Cleaning chores (`tub-clean`, `windows`, `living-room`, `toilet`) carry the same small sparkle (top-right) so they read as "clean this".
- Unknown chore icon: fall back to the generic `chores` icon rather than leaving the circle empty.

## Countdown kinds: icon, colour, celebration (2026-11-15)
Reference: `design/EventIcons.dc.html` (icon artwork, same line style: 24 grid, 1.9 stroke, round caps). Eva sends `kind` with each countdown; **unknown kinds fall back to `holiday`** (star, amber, confetti). The old `holiday` = snowflake mapping is replaced: the snowflake is now `winter` only.

| kind | Label | Icon | Colour | Tap effect |
|---|---|---|---|---|
| `holiday` | Holiday (default) | star | amber | Confetti rain |
| `visit` | Visit | gift | amber | Confetti rain |
| `birthday` | Birthday | cake | pink (or the birthday person's colour) | Balloons rise |
| `trip` | Trip | plane | blue | Confetti rain |
| `move` | Moving day | box | amber | Confetti rain |
| `anniversary` | Anniversary | heart | pink | Hearts rise |
| `recital` | Recital | music | violet | Notes rise |
| `sports` | Sports day | medal | amber | Confetti rain |
| `ceremony` | Graduation · entrance | cap | violet | Confetti rain |
| `school` | First / last day of school | bag | teal | Confetti rain |
| `new-year` | New Year (お正月) | sunrise | amber | Confetti rain |
| `setsubun` | Setsubun (節分) | oni | amber | Beans fall |
| `hinamatsuri` | Hinamatsuri (ひな祭り) | dolls | pink | Petals fall |
| `hanami` | Hanami (花見) | sakura | pink | Petals fall |
| `kodomo` | Children's Day (こどもの日) | carp | blue | Confetti rain |
| `tanabata` | Tanabata (七夕) | tanabata | violet | Stars fall |
| `obon` | Obon (お盆) | lantern | amber | Lanterns rise |
| `tsukimi` | Tsukimi (月見) | moon | violet | Stars fall |
| `valentine` | Valentine's Day | heart | pink | Hearts rise |
| `easter` | Easter | egg | violet | Confetti rain |
| `parents-day` | Mother's / Father's Day | flower | pink | Hearts rise |
| `july4` | Fourth of July | firework | blue | Confetti rain |
| `halloween` | Halloween | pumpkin | amber | Confetti rain (orange + purple) |
| `thanksgiving` | Thanksgiving | pie | amber | Leaves fall |
| `christmas` | Christmas | tree | green | Snow falls |
| `summer` | Summer break | sun | amber | Confetti rain |
| `autumn` | Autumn | leaf | amber | Leaves fall |
| `winter` | Winter break | snow | blue | Snow falls |
| `spring` | Spring break | sakura | pink | Petals fall |

- Colours: amber = `--warm`/`--warm-soft`, blue = `--cool`/`--cool-soft`, teal = `--accent`/`--accent-soft`, pink `#8c2a4f` on `#fbdde6`, violet `#4a3480` on `#e7defa`, green `#2f6b3c` on `#dcebd9` (new; add as `--green`/`--green-soft`).
- Effects are three motions with different particles, all within the ≤ 40-element, transform + opacity budget:
  - **Rain/burst:** confetti (burst from the icon + rain across the screen).
  - **Rise:** balloons, hearts, music notes, lanterns (soft amber circles), from the bottom edge across the screen.
  - **Fall:** snow, leaves (amber/orange leaf shapes), petals (pink), stars (small violet/amber), beans (small brown dots).
- Add the new icons to `web/icons.js`; keep keys equal to the Icon column.

## Weather: top-right card (2026-11-16)
**Decided:** the full-width weather card at the top of the right column, as shown in `design/EvaOptA.dc.html`, with the compacted DayFlow cards below it. The side-by-side (weather next to "Next up") variant is not being pursued for now.
References: `design/WeatherIcons.dc.html` (icons, day + dark, example cards), `design/EvaOptA.dc.html` / `EvaDayPortrait` / `EvaEvening` (in place).
- **Weather leaves the photo.** Remove the haloed weather row under the clock; the left side is now date, clock, Eva's bubble.
- **New first item in the right column**: a solid card (same style as the other cards), 128 px tall, full column width:
  - A 100 px tinted circle with the condition icon (64 px).
  - Temperature now at 96 px (display font).
  - High ↑ and low ↓ at 38 px (amber up arrow, blue down arrow, numbers in ink).
  - One line, 24 px muted, of what's coming ("Sunny now · rain from 15:00", "Rain until 22:00", "Gusts up to 40 km/h").
- **Conditions → icon key → tint** (add to `web/icons.js`):
  - `sun` and `partly`: amber.
  - `cloudy` and `fog`: grey (`--surface-200` with `--ink-muted`).
  - `rain` and `snow`: blue.
  - `storm`: violet.
  - `wind` (breezy): teal.
  - `night` and `night-cloud`: violet. Use these instead of sun icons after sunset.
- Map Open-Meteo weather codes to these keys in `server/weather.ts` (clear 0 → sun/night, 1–2 → partly/night-cloud, 3 → cloudy, 45/48 → fog, 51–67 and 80–82 → rain, 71–77 and 85–86 → snow, 95–99 → storm). Use `wind` when gusts ≥ 35 km/h and nothing wetter is happening.
- **Space budget update.** The right column is now: weather (128) + "Next up" + Today/Tomorrow, still ≤ ~740 px and never under the strip. To make it fit, the DayFlow cards are compacted:
  - Next-up countdown at 80 px (was 104); card padding 20 × 28.
  - Today/Tomorrow rows: 48 px avatars, 48 px pills, 24 px text, row gap 10.
  - Check: busiest morning (weather + leave-for-school + 4 people) and busiest evening (weather + bedtime with bath + tomorrow with pack row) both fit. If not, the existing trim rules apply.
- The active view keeps its hourly strip in the header (unchanged).

## Eva bubble (2026-11-16) — chosen: option A
References: `design/EvaCharacter.dc.html` (character, 3 expressions, light + dark), `design/EvaOptA.dc.html` (day, landscape), `design/EvaDayPortrait.dc.html` (day, single portrait), `design/EvaEvening.dc.html` (evening), `design/EvaNight.dc.html` (night), `design/EvaActive.dc.html` (active view), `design/EvaStates.dc.html` (states + motion). `EvaOptB` / `EvaOptC` are rejected options: reference only.

**Character**
- Port the SVG from `EvaCharacter.dc.html` exactly (one component, props: `expr`, `theme`, `size`, `peek`). Shell: cream `#fffaf1` / edge `#c9b89c` by day; `#2a303b` / `#46505f` in evening and night. Face screen `#0b0e12`.
- Eyes: mint `#7cf2c4`, desk proportions scaled ×0.16 (16.6 × 21.1, radius 1.5, gap 48 in a 140 × 84 screen). The glow is two translucent larger rects (32% and 14%): **no blur filters**.
- Expressions: `happy` (default), `excited` (^ ^ eyes, open mouth, three sparkles), `sleepy` (closed eyes, "o" mouth, z z, dimmed mint; night only).

**Placement (calm view, day and evening)**
- Eva peeks up from behind the bottom strip at the photo's lower-left: absolutely positioned at `left: 112px; bottom: 188px`, 170 px wide, `peek` (no body), **stacked below the strip tiles and above the photo**, so the strip hides her chin. Eyes and mouth must stay visible above the strip.
- The bubble sits at the bottom of the left column, `padding-left: 186px`, max width 640, tail pointing down-left at Eva. It is the only solid shape allowed on the photo, and it lives in the lower part of the photo (away from faces).
- The memories caption moves to a small pill at the top-left of the stage (`left: 104px; top: 28px`).
- The right column and its space budget are unchanged.
- **Night:** sleepy Eva, no bubble, about 38% opacity, under the clock block; she drifts with it.
- **Active view:** the "Eva says" card is replaced by the bubble (tail down) with a 104 px peeking Eva under it, same message.

**Bubble**
- Day: `#fffaf1`, 1px `#c9b89c`, soft shadow. Evening: `#151a22`, 1px `#2c3544`, light ink. Radius 28, padding 18 × 26.
- Main line 28/36 px weight 600, max 2 lines then ellipsis (~90 chars). Optional second line 22/30 muted, 1 line (~60 chars).
- No emoji: strip them from Eva's text (later: map to board icons).
- Nothing to say: no bubble and no placeholder; Eva still peeks, happy.

**Alive (motion), all one-shot CSS, transforms and opacity only**
- **Blinking:** a single blink (eyes `scaleY` 1 → 0.12 → 1, 260 ms) at random intervals of 6–20 s while awake. Occasionally (≈1 in 5) a double blink. Never while asleep.
- **New message arrives:**
  1. The old bubble fades out (150 ms).
  2. Eva reacts: she switches to `excited` for ~1.2 s (sparkles appear), with a tiny hop (translateY −6 px and back, 300 ms).
  3. The new bubble pops in from the tail corner (scale 0.6 → 1 with a small overshoot, 450 ms).
  4. She blinks once, then settles into the message's `mood` (`happy` or `excited`).
- **Mood follows context:** `excited` when the message is about an upcoming event or the countdown celebration is playing (she cheers along); `happy` otherwise; `sleepy` at night. When the countdown tile is tapped, Eva goes `excited` for the celebration and then returns.
- **Idle:** nothing else moves (no bobbing, no looping glow). Respect `prefers-reduced-motion`: no hop or pop, keep the expression change.

**Data (from Eva)**
- Panel `eva`: `{ "text": "...", "sub": "...", "mood": "happy" | "excited", "at": ISO time }`. Eva pushes a few times a day. Absent panel = nothing to say (no bubble). The old `note` panel maps to this for now.

## Household and behaviour (don't regress)
- Only Mariko (11) and Sarina (8) have chores. Michael and Nozomi appear in the schedule only.
- Every chore tap answers instantly, with an 8 s Undo toast. Single taps only: no long-press, swipe or text entry.
- Pay: "¥N to pay" (¥100 per chore, from the board's log) + Mark paid (amber) → "Paid up"; second line "Last paid <date>". Mark paid pays exactly what is owed — a second tap while one is in flight does nothing, and a 409 (balance changed) toasts "Balance changed" with no retry wording. Paid more than earned shows "¥N credit" in ink-muted with no button, never "Paid up". Bath order alternates nightly; Swap overrides tonight and counts as history.
- Photos: landscape fills the screen; a portrait goes in the left half with the right half plain. **One photo at a time — never pair portraits.**
- Leave-for-school is real now (`server/routine.ts`): 7:55 Mon–Fri, shown only in the 45 min before (DESIGN.md). Never in the evening, never at weekends.
- Bedtime 20:30 Sun–Thu, 21:00 Fri–Sat: a schedule row plus the countdown card in the 30 min before; night mode stays 21:30.
- Countdown tile ("Coming up", ASC-25) rotates every 20 s, nearest first, through the nearest calendar birthday (always included), the nearest major JP/US holiday and the nearest one-off school event from the calendar (`server/occasions.ts`, `occasions` panel), plus everything Eva pushed in `countdowns` (merged and deduped in `web/comingup.js`; hers win a same-day clash). DESIGN.md has the rules. Tapping it celebrates as described above (particles copied into `web/celebrate.js`, `countTile()`/`celebrate()` in app.js).
- Countdown chimes (ASC-32, DESIGN.md "Countdown chimes"): beep-boop when the Next-up card appears, a music-box alarm at 5 min out, once per event per day, never at night or for dummy content. Policy and synthesis are pure in `web/chime.js` (tested); `chimeCheck()` in app.js owns the clock and the Audio element.
- The page background is fully solid, so nothing from the Echo's own screen shows through.

## Silk constraints
Low-powered Chromium. CSS transitions only (theme switch is a 1.5 s crossfade on variables), no blur filters, no video, pre-sized images. Test with `?theme=day`, `?time=7:42`, `?mode=ambient|active|night`, `?debug=1`.
