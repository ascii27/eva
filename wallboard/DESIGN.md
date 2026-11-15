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
| ~06:30–21:00 | **Day — "Morning paper v2 · sand"** | Chosen after testing on the Echo (v1 was too bright and flat). Tokens in `design/PaperV2Sand.dc.html` `:root`: ground #d6c7ae, cards #fffaf1 with 1px #c9b89c edge and a stronger shadow, ink #1d1712, muted #4b4034, done-teal #0b6760. Memory photo under a 50% sand veil; clock and weather sit directly on the photo (no card) so the photo stays visible |
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
| Portrait | ≤ 0.9 | **Pair** with the next portrait in the queue: two halves side by side (8 px gap), each `cover` |
| Portrait, no partner available | ≤ 0.9 | **Single, left**: fills the left half (same slot as the pair's left photo, `cover`); right half stays plain theme ground |
| Square-ish | 0.9–1.2 | Treat as a single portrait (left half) |

- No blurred-copy fill behind portraits: large blurs are too heavy for Silk.
- Pairing: queue scans ahead up to ~5 photos for a portrait partner; keep the album order otherwise. Prefer pairing photos from the same day/event when metadata exists.
- Pre-size on the server: landscape to 1920 px wide, portrait to 1080 px tall (JPEG ~80%), so Silk never decodes full camera files.
- Faces: in pair mode the clock sits over the left photo; if face boxes are available, prefer the photo with the face lower in frame on the left.
- Mockups: `design/PaperPortraitPair.dc.html`, `design/PaperPortraitSingle.dc.html` (single = left half, right blank); placeholders `assets/portrait-a.svg`, `assets/portrait-b.svg`.

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
