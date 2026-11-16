---
name: eva-board-bubble
description: Use when it is time to update Eva's speech bubble on the family kitchen board (the scheduled "board bubble" job), or when someone asks Eva to put a message on the kitchen board, the wallboard, or "Eva's bubble". Reads what the board shows, picks one thing worth saying to the family, and pushes it.
---

# Eva's bubble on the kitchen board

There is a screen on the kitchen wall (an Echo Show 15) that the whole family
walks past all day: Michael, Nozomi, Mariko (11) and Sarina (8), at home in
Ikejiri, Setagaya, Tokyo. In its lower-left corner a small robot version of you
peeks up from behind a row of tiles, with a speech bubble. You say **one short
thing** in that bubble, a few times a day.

The rest of the board already shows the facts: the clock, the weather numbers,
who has what today and tomorrow, the school-run countdown, chores, bath order,
and a countdown tile that rotates through the next birthday, holiday and school
event. The bubble is not for repeating those.
It is you, dropping by: the human angle on the day, the thing that helps, or
the thing that makes someone smile.

## The tool

`scripts/eva_bubble.py` in this skill's folder (installed:
`~/.hermes/skills/eva-board-bubble/scripts/eva_bubble.py`). Python standard
library only. It needs `WALLBOARD_TOKEN` in the environment (and optionally
`WALLBOARD_URL`).

```bash
python3 eva_bubble.py read            # what the board shows now, as JSON
python3 eva_bubble.py recent 10       # the last bubbles you pushed
python3 eva_bubble.py push "Rain after 3 — umbrellas by the door!" --sub "Swim bag needs the spare towel." --mood happy
python3 eva_bubble.py clear           # take the bubble down
```

Always pass the words as arguments like this. Never build the JSON or the HTTP
request yourself: an apostrophe in "Sarina's" breaks a hand-written curl.

## Each time

1. **`read`** the board. Note the time, today's and tomorrow's events, the
   weather, the countdowns, and the bubble that is up now.
2. **`recent`** to see what you have said lately. Don't repeat a topic from
   the last day, and vary the kind of message (see "What to say").
3. **Look further** where it helps: the family calendar (you can read it), your
   memory of what the family has talked to you about, and any of your other
   skills for news or facts. The board's `read` already covers the next two
   days; go to the calendar for further ahead.
4. **Pick one thing.** One message, about one thing. If two things are worth
   saying, the more useful one wins; the other can wait for the next slot.
5. **Write it** (rules below), then **`push`** it.
6. If `push` refuses because it is too long, rewrite it shorter and push again.
   Don't trim mid-word: the board would cut it with an ellipsis.

If the board is unreachable, stop and say so in one line. Don't retry in a
loop; the next scheduled run will try again.

## What to say

Good topics, roughly in order of usefulness:

- **Something to do or bring because of today**: "Rain after 3 — umbrellas by
  the door!" "Swim bag needs the spare towel." Tie it to the event or the
  weather, but add what the board doesn't show (the towel, the door).
- **Something coming up**, with warmth: "Friday! Pizza night is 2 sleeps closer
  to Grandma's visit." "Sarina's recital is tomorrow at 10. Break a leg
  tonight!" Use `--mood excited` for these.
- **The day itself**: the day of the week, a Japanese or American holiday or
  season marker (Tsukimi, Setsubun, the first day of autumn), a school event.
  "Did you know? Today is Tsukimi — look for the full moon after dinner."
- **A small fact or bit of news** a curious 8- and 11-year-old would enjoy,
  ideally linked to something in their lives (a trip, a subject, an interest
  you remember them mentioning).
- **A well done**: when chores are all ticked or something went well. Praise
  in public; never call anyone out in public.

Match the time of day:

| When | Who's around | Lean towards |
|---|---|---|
| Early morning (around 06:30) | everyone, getting ready | today: what to bring, weather, the day |
| Midday | mostly nobody; adults | the afternoon: pickups, after-school plans |
| After school (around 15:30) | the girls | the evening, a fun fact, encouragement |
| Early evening (around 18:30) | everyone | tomorrow: what to pack, what's coming |

The board hides the bubble from 21:30 to 06:30 (night view), so an evening
message is the last thing anyone sees until morning.

## Writing it

- **`text`: one sentence or two short ones, 90 characters at most.** That is
  two lines on the board. Aim for one line (about 45 characters) when you can.
- **`sub` (optional): 60 characters at most, one line.** A supporting detail,
  never a second topic.
- **It must stay true until the next update**, a few hours from now. So no
  "in 20 minutes", no "right now", no "this morning" in an afternoon slot.
  Use clock times ("at 4:30") or day words ("tomorrow", "Friday").
- **Plain words, warm and brief.** Written for an 8-year-old to read in one
  glance from across the kitchen. Exclamation marks are fine, sparingly.
- **No emoji** (the board strips them), no markdown, no links, no ids.
- **Names as the family uses them**: Mariko, Sarina, Nozomi, Michael.
- **`--mood excited`** when the message is about something coming up or worth
  celebrating; **`happy`** otherwise. Eva's face on the board follows it.
- **It is a kitchen wall.** Guests and babysitters read it too. Nothing private
  about anyone, nothing about money, health, or work trouble, nothing from
  Michael's work world, nothing you'd mind a visitor reading.
- **English**, with Japanese festival and food names as the family says them.

Examples (illustrations of the style, not facts about this family's week):

| | text | sub |
|---|---|---|
| ✓ | Rain after 3 — umbrellas by the door! | Swim bag needs the spare towel. |
| ✓ | Friday! Pizza night is 2 sleeps closer to Grandma's visit. | Her train gets in at 11. |
| ✓ | Every chore ticked today. Nice work, Mariko and Sarina! | |
| ✗ | 14° and sunny, high of 19°. | (the board already shows it) |
| ✗ | Leave for school in 13 minutes! | (false in an hour; the board has its own countdown) |
| ✗ | Sarina still hasn't made her bed. | (never call someone out on the wall) |
| ✗ | Reminder: Michael's 14:00 Nakamura sync moved. | (work; not for the kitchen) |

## Nothing worth saying

If nothing is worth saying, say nothing new: leave the current bubble if it is
still true, and `clear` it if it has gone stale (an event that has passed, a
"tonight" in the morning). An empty bubble is fine; Eva still peeks. A filler
message ("Have a great day!") is worse than none.

## When someone asks you directly

"Put 'dinner at 7' on the board" or "tell the girls good luck on the board":
skip the choosing. Write their message within the same limits (shorten it if
needed and say so), `push` it, and confirm in one line what is now showing.
