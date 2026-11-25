# Kitchen wallboard — design notes

Echo Show 15, landscape 1920×1080, Silk browser. Built on the **Haven** design system (dark-first, teal = "on/done").
Canvas: https://claude.ai/code/artifact/ec029acd-8bfe-40f4-965b-b8a6eafaac78

Files in `design/` are the canvas artboard sources (`.dc.html`); they are design references, not the production page.

## Household
Michael, Nozomi (parents) · Mariko (11), Sarina (8). Avatar colours: Mariko violet `#c4a4ff`, Sarina pink `#ff9cc0`,
Nozomi amber (Haven `warm`), Michael blue (Haven `cool`). Always shown with name or initials, never colour alone.

## States
| State | Trigger | Shows |
|---|---|---|
| Ambient | default; 60 s after last touch | Clock, weather now, one live countdown (leave-by), Eva's note, next 3 events, chore progress strip, one countdown, dimmed memory photo behind |
| Active | any tap on ambient | Hourly weather, full day schedule, tappable chores per person, Eva, leave/pickup, countdowns |
| Night | 22:00–06:00 (or ambient light sensor if exposed) | Clock, tomorrow's first commitment, weather. Pure black, warm dim text, no photo. Tap → dimmed active view |

## Themes by time of day
| Window | Theme | Notes |
|---|---|---|
| 06:00–21:00 | **Day — "Morning paper v3 · halo"** | v2 sand colours (v1 was too bright and flat on the Echo): ground #d6c7ae, cards #fffaf1 with 1px #c9b89c edge and a stronger shadow, ink #1d1712, muted #4b4034, done-teal #0b6760. Memory photo under a 35% sand veil; text sits directly on the photo with a cream halo (`text-shadow: 0 0 2px #fffaf1, 0 0 6px #fffaf1, 0 0 22px rgba(255,250,241,.95)`), heavier weights (clock 400, date 700) and full ink. Same treatment for landscape and single portrait (portraits are never paired). Caption on a cream pill. References: `design/PaperV3HaloLandscape.dc.html`, `PaperV3Halo.dc.html` |
| 21:00–bedtime | **Evening — Haven Night** (dark) | Current dark design (`Main`, `Active`) |
| 22:00–06:00 | **Night mode** | Pure black, warm dim text |

- Switch with a 1.5 s background/colour crossfade (CSS variables on `:root`, `transition` on background/color only). No reload.
- Paper runs into the evening on purpose (changed from 17:30 on 2026-11-15): the family wanted the light board until 21:00, not tied to sunset.
- Teal still means "done" in every theme; Mariko/Sarina avatars use light tints with dark initials by day. Superseded design files (LightPaper = v1, PaperV2Cards, LightDay/Pastel/Photo) are reference only.

## Right column through the day
Morning: "Next up" (leave for school + bring) above a per-person **Today** card. During the day: next item within the hour becomes the "Next up" card; done items fade to dashed outlines. After dinner (all done or 18:30): the evening "Next up" (usually Bedtime, with the bath-order row inside it) + **Tomorrow** with "Pack tonight". Never more than 2 cards; people with nothing are left out; the list compacts (shared events merged, 2 pills + "+N more", then rows dropped behind "+N more") until it fits above the strip. "Eva says" is off the calm view for now. Full rules in `CLAUDE.md`; reference `design/DayFlow.dc.html`.

## Hierarchy (ambient)
1. Time + date (300 px) — readable at 4 m
2. The one time-critical fact (leave for school in N min) — the only glowing element
3. Eva's note (short, ≤ 2 lines at 34 px)
4. Later today (3 items) · chore progress · one countdown

### Day calm strip (v3, `PaperV3HaloLandscape`)
Read from across the kitchen, so icons, not text. 168 px tall, four cards (radius 28, gap 24):
- **Each girl:** 84 px avatar with her name under it (22 px bold), then one 64 px circle per chore with the chore's icon — teal with a small check badge when done, an empty ring when not. A teal star badge on the avatar when everything is done. More than four chores shrink the circles to fit. No counts, chore names or pay (those are in the active view).
- **Bath:** 96 px blue disc with a bathtub, then the avatar of whoever goes first with a "1st" pill.
- **Countdown:** 96 px amber disc with the gift, the number at 88 px, then "days · Label". A long label wraps to a second line.
- The evening board (`Main`) uses the same strip with the dark tokens.

### Countdown tile celebrations (`design/EventTiles.dc.html`)
At rest the tile reads number / "days" / label, each line single with an ellipsis. Tap it (it doesn't open the active view): the icon wiggles and shrinks 96 → 72 px, a small burst comes out of it, the effect fills the whole screen, and the text swaps to a headline, the day ("Sat 28", or "Thu 24 Dec" in another month) and "N sleeps to go" (18 / 32 / 20 px). Back after 4.8 s (5.6 s for balloons and snow); tapping again restarts it. One effect per kind:
- **visit** (default for an Eva push): gift whose lid pops, confetti from the gift and raining over the screen, amber.
- **birthday**: cake whose flame flickers, balloons rising across the screen, in the person's colours ("Sarina turns 9").
- **holiday**: snowflake, snow drifting down the screen, blue. The server's holiday default always uses this one, Halloween and July 4th included.
- Particles are copied from the design file into `web/celebrate.js` and removed when the effect ends. Reduced motion hides them; the text swap stays.

## What's on in Tokyo (ASC-35, drafted 2026-11-23)
Family-friendly events near home from Tokyo Cheapo. In the **active view only** (the calm view stays as it is): a "This weekend" card at the bottom of the right column with photo rows, which gives way to the other cards when space is tight. Tapping a row opens a detail sheet (photo, dates, hours, place and distance, price, a paragraph) where the family picks a day and taps **Ask Eva to add it**. Eva (hermes) puts it on the family calendar a few minutes later, and the card then marks it "On the calendar". **Take it off** reverses it. "See all" opens a paged browse sheet. Eva's bubble suggests one now and then. Values and states: `CLAUDE.md` "What's on in Tokyo".

## Routine (decided 2026-11-15, `server/routine.ts`)
- Leave for school: Mariko & Sarina, **7:55 every weekday** (Mon–Fri), even on school holidays in the calendar. The card shows in the 45 min before.
- Bedtime: **20:30 Sun–Thu, 21:00 Fri–Sat**, as a "Bedtime" row in today's schedule, plus the same teal countdown card as the school run (moon icon, "in bed by 20:30") in the **30 min** before. They never overlap. It does **not** move night mode, which runs 22:00–06:00 (changed from 21:30–06:30 on 2026-11-18).
- Night view's "Tomorrow" line: the earlier of tomorrow's school run and tomorrow's first timed event; bedtime never counts.

## Countdown tile: "Coming up" rotation (decided 2026-11-15, rotation 2026-11-16 / ASC-25, `server/occasions.ts`, `web/comingup.js`)
- The bottom-right tile **rotates** through the coming occasions, one every **20 s**, nearest first. The tile stays put; its icon and text crossfade (0.4 s opacity, skipped under `prefers-reduced-motion`). It holds still while a celebration plays, and a tap celebrates whichever occasion is showing.
- The rotation is the server's defaults plus everything Eva pushed in `countdowns`:
  - the **nearest birthday** from the calendar (any event titled "birthday"/"誕生日", yearly repeats included). Always in the rotation, however far off;
  - the **nearest major holiday**: New Year, Hinamatsuri, Easter, Children's Day, Mother's Day, Father's Day, July 4th, Halloween, Thanksgiving, Christmas;
  - the **nearest school event**, if the calendar has one: a one-off (non-recurring) event titled like 運動会/体育祭/sports day (`sports`), 発表会/音楽会/学芸会/recital (`recital`), 入学式/卒業式/graduation (`ceremony`), or 始業式/終業式/授業参観/遠足/修学旅行/保護者会/個人面談/学校/school/field trip (`school`).
- Each strictly after today (on the day it moves to the next one). A birthday wins a tie.
- Eva's pushes **join** the rotation (they used to replace it). If one of hers falls on the same day as a default with the same kind or label, hers is shown and the default dropped.

## All-day events (decided 2026-11-15)
- From the family calendar (school holidays, trips). Pinned at the **top** of the Today card and of ambient "Later today", for the whole day, with "ALL DAY" in the time column.
- The label uses the eyebrow style (20 px, 600, uppercase, 0.08em; 18 px in the Today card's narrower column) because "All day" doesn't fit the time column at clock size. Never "past", never the highlighted "next" row.

## Chores interaction
- Single tap toggles done. Press scale 0.97 / 120 ms; fill + check pop ≤ 1 frame after tap.
- Toast with Undo (80 px button) for 8 s, draining bar. Undo restores the prior state; tapping a done card un-does it with its own undo.
- Last chore for a person → "All done" + star; summarised on ambient.
- Glow only on the just-finished card (fades with the toast) so glow never covers > ⅓ of screen.

## Memory photos: landscape and portrait
Layout is chosen per photo by aspect ratio (width ÷ height), checked once when the photo loads:

| Photo | Ratio | Layout |
|---|---|---|
| Landscape | ≥ 1.2 | Full-bleed background, `object-fit: cover` |
| Portrait | ≤ 0.9 | **Single, left**: fills the left half (956 px, `cover`); right half stays plain theme ground. **Never paired** — one photo at a time (decided 2026-11-15) |
| Square-ish | 0.9–1.2 | Treat as a single portrait (left half) |

- No blurred-copy fill behind portraits: large blurs are too heavy for Silk.
- Pre-size on the server: landscape to 1920 px wide, portrait to 1080 px tall (JPEG ~80%), so Silk never decodes full camera files.
- Faces: the clock sits over the portrait; if face boxes become available, prefer crops that keep the face below the clock.
- Mockup: `design/PaperPortraitSingle.dc.html` (left half, right blank). `PaperPortraitPair.dc.html` is superseded — pairing was dropped. Placeholders `assets/portrait-a.svg`, `assets/portrait-b.svg`.

## Countdown chimes (ASC-32, decided 2026-11-17, `web/chime.js`)
- When the "Next up" card starts counting down (school run 45 min before, bedtime 30, a calendar event 60), the board plays a short robot **beep boop… bip!** (~0.5 s).
- At **5 minutes** out it plays a cute music-box **alarm**: a rising C-major arpeggio twice, ending on a held high C (~2.8 s). A card that first appears inside 5 minutes plays the alarm alone.
- Each cue plays **once per event per day**, remembered across reloads. Never in night mode, and never for dummy content.
- Synthesized in the page (no audio files). Silk only allows sound after the board has been tapped once, which the keep-alive's first tap already does; after a reload, sound resumes on the next tap.

## Always-on / burn-in
- Memory photo crossfades every 3–5 min (CSS opacity transition, pre-sized JPEGs ≤ 1920 px, dimmed with a flat 62% overlay — no blur filters).
- Ambient content block drifts ±16 px on a 10-min cycle (CSS transform); night block relocates every 10 min.
- Leave-by card only exists inside its window (e.g. 45 min before departure), so the brightest element isn't static all day.

## Eva integration
Eva pushes: `note` (1–2 sentences + optional secondary line), `leaveBy` {label, who, at}, `pickup`, `countdowns[]`, `schedule[]`, `chores` per person. Board writes back chore completions (who, chore, time) so Eva can mention them.

## Build checks before production
- Confirm Silk's CSS viewport on the device (`innerWidth`/`devicePixelRatio`); if it isn't 1920 wide, scale one root container rather than re-laying out.
- Prefer Inter/Space Grotesk self-hosted (woff2) to avoid font flashes when offline.
- Memory photos: placeholder `assets/memory-placeholder.svg` stands in for the real album.
