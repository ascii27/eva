---
name: eva-events
description: Use when the kitchen board asks you to run the board events sync (putting Tokyo events the family picked on the kitchen board onto the family calendar, or taking them off), and when anyone asks what's on in Tokyo, what to do this weekend, or about an event they added from the board. Reads the board's requests through the script; the calendar is yours, through your own calendar tools.
---

# Tokyo events from the kitchen board

The kitchen board (an Echo Show 15 on the wall) has a **This weekend** card:
family-friendly events in Tokyo from Tokyo Cheapo, near home in Ikejiri,
Setagaya. Anyone in the family (Michael, Nozomi, Mariko 11, Sarina 8) can tap
an event, read about it, pick a day, and tap **Ask Eva to add it**. Later they
can tap **Take it off**. The board can't touch the calendar itself; it records
the request as a *plan* and waits for you. Until you report back, the board
says "Asking Eva to add it".

## The tool

`scripts/eva_events.py` in this skill's folder (installed:
`~/.hermes/skills/eva-events/scripts/eva_events.py`). Python standard library
only. It needs `WALLBOARD_TOKEN` in the environment (and optionally
`WALLBOARD_URL`), the same as the other board skills.

```bash
python3 eva_events.py pending                                   # what's waiting, with the calendar entry to make
python3 eva_events.py done tc-401506 --want add --ref <calendar entry id>
python3 eva_events.py done tc-401506 --want remove
python3 eva_events.py failed tc-401506 --want add --note 'I can'\''t write to the family calendar yet'
python3 eva_events.py list                                      # every plan, including done ones
```

Put `--note` in single quotes, and write an apostrophe inside it as `'\''`.

## The sync

**There is no schedule.** The board wakes you itself when someone taps (about a
minute after the last tap, one message for everything pending), with a message
starting *"From the kitchen board: the family asked you to…"*. If a request is
still pending 30 minutes later it asks again, at most three times in all. A
schedule would cost a full run every time it fired, whether or not anyone had
tapped anything. Only if the board can't reach you (no `HERMES_AGENT_URL`/`KEY`
in its env) does this need a schedule; then once or twice a day is plenty.

When woken, or asked to "run the board events sync":

1. **`pending`.** If it prints `[]`, there is nothing to do. Stop, and report
   nothing.
2. For each plan, in order, **make the family calendar match its `want`**.
   Use the family calendar, the one the board reads. Not Michael's work calendar.
   - **`want: add`.** First look on `day` for an entry you already made for it:
     the one whose id is `ref`, or one with the same title. If there is one on
     that day, don't add another. If `ref` points to an entry on a *different*
     day, the family moved it: delete that one first. Otherwise create the
     entry exactly as `entry` describes:
     - title;
     - `start`/`end` (Tokyo time), or all-day on `date` when `allDay` is true;
     - location;
     - notes.

     No invitees. Then run `done <id> --want add --ref <the entry's id>`.
   - **`want: remove`.** Delete the entry whose id is `ref`. With no `ref`,
     delete the one on `day` with the same title. If there is none, it is
     already gone, which is fine. Then run `done <id> --want remove`.
3. **If you can't**, run `failed <id> --want <want> --note '<why>'`. Write the
   note for the family to read on the board: a few plain words, 200 characters
   at most ("I can't write to the family calendar yet", "The calendar didn't
   answer; tap Try again"). Cases include:
   - you have no tool that can write the family calendar;
   - the calendar refused;
   - it's unreachable.

   Never leave a plan pending because something failed. A pending plan reads
   as "Eva's on it" for ever.
4. **Exit 3 ("the family changed this plan")** means someone tapped again
   while you worked. Nothing was recorded. Run `pending` again and act on what
   it says now: the calendar should end up matching the *latest* want. An
   entry you just added for a plan that is now `remove` gets deleted.

Each step is safe to repeat. Checking the day before adding is what stops a
retried run from adding the event twice.

## When someone asks

- "What's on this weekend?" / "Anything fun to do?" Use `read` from the
  eva-board-bubble skill. Its `tokyo_this_weekend` is the same list the board
  shows, already filtered for the family. Suggest one or two, with the day,
  roughly how far, and the price if known. Don't recommend anything that isn't
  on that list as if it came from the board.
- "Add the dance show on Friday to the calendar." If it's on the board's list,
  tell them to tap it on the board, or add it to the calendar yourself. A plan
  only exists when it was tapped on the board, and you can't create one.
- Prices on the board are what the page listed. "Price not listed" means
  unknown, not free.
