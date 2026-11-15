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
| Active | any tap on ambient | Hourly weather, full day schedule, tappable chores per person, Eva, leave/pickup, dinner, countdowns |
| Night | bedtime (~21:30)–06:30 (or ambient light sensor if exposed) | Clock, tomorrow's first commitment, weather. Pure black, warm dim text, no photo. Tap → dimmed active view |

## Themes by time of day
| Window | Theme | Notes |
|---|---|---|
| ~06:30–21:00 | **Day — "Morning paper v3 · halo"** | v2 sand colours (v1 was too bright and flat on the Echo): ground #d6c7ae, cards #fffaf1 with 1px #c9b89c edge and a stronger shadow, ink #1d1712, muted #4b4034, done-teal #0b6760. Memory photo under a 35% sand veil; text sits directly on the photo with a cream halo (`text-shadow: 0 0 2px #fffaf1, 0 0 6px #fffaf1, 0 0 22px rgba(255,250,241,.95)`), heavier weights (clock 400, date 700) and full ink. Same treatment for landscape and single portrait (portraits are never paired). Caption on a cream pill. References: `design/PaperV3HaloLandscape.dc.html`, `PaperV3Halo.dc.html` |
| 21:00–bedtime | **Evening — Haven Night** (dark) | Current dark design (`Main`, `Active`) |
| bedtime–06:30 | **Night mode** | Pure black, warm dim text |

- Switch with a 1.5 s background/colour crossfade (CSS variables on `:root`, `transition` on background/color only). No reload.
- Paper runs into the evening on purpose (changed from 17:30 on 2026-11-15): the family wanted the light board until 21:00, not tied to sunset.
- Teal still means "done" in every theme; Mariko/Sarina avatars use light tints with dark initials by day. Superseded design files (LightPaper = v1, PaperV2Cards, LightDay/Pastel/Photo) are reference only.

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
- The evening strip (`Main`) keeps its own layout: counts, progress bars, pay.

## Routine (decided 2026-11-15, `server/routine.ts`)
- Leave for school: Mariko & Sarina, **7:55 every weekday** (Mon–Fri), even on school holidays in the calendar. The card shows in the 45 min before.
- Bedtime: **20:30 Sun–Thu, 21:00 Fri–Sat**, as a "Bedtime" row in today's schedule, plus the same teal countdown card as the school run (moon icon, "in bed by 20:30") in the **30 min** before. They never overlap. It does **not** move night mode, which stays 21:30–06:30.
- Night view's "Tomorrow" line: the earlier of tomorrow's school run and tomorrow's first timed event; bedtime never counts.

## Countdown tile default (decided 2026-11-15, `server/occasions.ts`)
- When Eva hasn't pushed `countdowns`, the bottom-right tile shows the **nearest** upcoming occasion: a birthday from the calendar (any event titled "birthday"/"誕生日", yearly repeats included) or one of these holidays: New Year, Hinamatsuri, Easter, Children's Day, Mother's Day, Father's Day, July 4th, Halloween, Thanksgiving, Christmas.
- Strictly after today (on the day it moves to the next one), a birthday wins a tie, gift icon. Eva's `countdowns` push always overrides it.

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

## Always-on / burn-in
- Memory photo crossfades every 3–5 min (CSS opacity transition, pre-sized JPEGs ≤ 1920 px, dimmed with a flat 62% overlay — no blur filters).
- Ambient content block drifts ±16 px on a 10-min cycle (CSS transform); night block relocates every 10 min.
- Leave-by card only exists inside its window (e.g. 45 min before departure), so the brightest element isn't static all day.

## Eva integration
Eva pushes: `note` (1–2 sentences + optional secondary line), `leaveBy` {label, who, at}, `pickup`, `dinner`, `countdowns[]`, `schedule[]`, `chores` per person. Board writes back chore completions (who, chore, time) so Eva can mention them.

## Build checks before production
- Confirm Silk's CSS viewport on the device (`innerWidth`/`devicePixelRatio`); if it isn't 1920 wide, scale one root container rather than re-laying out.
- Prefer Inter/Space Grotesk self-hosted (woff2) to avoid font flashes when offline.
- Memory photos: placeholder `assets/memory-placeholder.svg` stands in for the real album.
