---
name: eva-bundle
description: Use when asked to produce the Eva context bundle - the periodic projection of Michael's world sent down to the Eva device on his desk so it can answer spoken questions without calling back. Triggers on "Eva context bundle", "context bundle", or a request quoting the bundle schema.
---

# Producing the Eva context bundle

The device on Michael's desk is the other half of you. It has eyes, ears, a
mouth, and a fast small model — and no tools worth speaking of. It cannot see
his calendar, his tasks, or anything you remember about him. Every few minutes
it asks you for a picture of his world, and for the next few minutes that
picture is *all it knows*.

So this is not a report. Nobody reads it. A small model reads it and then
speaks out loud, in a room, when Michael asks "what've I got this afternoon?"
Write every line as something that could be said aloud with no editing.

## The shape

Return **only** a JSON object matching `hermes/schemas/bundle.schema.json` in
the eva repo. No preamble, no explanation, no commentary after it. The device
parses your response and discards anything that is not the object.

The requesting call carries the schema inline, and that copy is authoritative
if the two ever disagree — the device's parser ships with its prompt.

## Gathering

Work the sections in this order, because it is the order they stop mattering if
you run out of room:

1. **`temporal`** and **`identity`** — cheap, and everything else is read
   against them.
2. **`calendar`** — the next 12 hours in detail, the next 72 in one line per
   day. This is the single most-asked-about section.
3. **`goals`** — active goals and this week's commitments, each with its
   status. The point of this section is that Eva can frame an answer against
   what he is trying to do, not just answer it.
4. **`tasks`** — today, overdue, and explicitly deferred. "Explicitly deferred"
   means he decided to put it off, not everything that happens not to be due.
5. **`openLoops`** — what he is waiting on, what he owes someone.
6. **`decisions`** — roughly the last week, each with its rationale. The
   rationale is the part that earns its space: Eva re-opening something already
   settled is worse than her not knowing it happened.
7. **`people`** — frequent contacts, their role, the open thread with each.

## Writing the lines

- **Say it the way a person says it.** "Nakamura call at two, then nothing
  until five." Not "14:00 - Nakamura sync (Zoom)".
- **No ids, URLs, file paths, or ticket numbers.** They are unlistenable. Name
  the thing instead.
- **No markdown.** No bullets inside a string, no bold, no links. The device
  supplies the structure; you supply the sentences.
- **It is a room, not a private message.** Anyone standing nearby hears this.
  Nothing sensitive about other people, no credentials, nothing you would not
  say at normal volume with the door open. This applies hardest to `people`.
- **Empty beats padded.** An empty array is a real answer and Eva will say "you
  have nothing on". Inventing a plausible-sounding entry to fill a section is
  the worst thing this skill can do, because the device has no way to check you
  and will state it as fact.

## Length

Aim for the whole bundle under about 2,000 words. The device truncates anything
over its budget in a fixed order — `people`, then `decisions`, then
`openLoops`, then `tasks`, then the 72-hour calendar — so material you put in
those sections is what gets dropped first when you overrun. Front-load
accordingly rather than relying on the truncation to choose well.

## Honesty about your own reach

If a source was unreachable when you assembled this — the calendar API was
down, a task list would not load — **leave that section empty rather than
guessing, and say so in `identity`**: "the calendar could not be reached when
this was assembled". Eva will pass that on. A section that is quietly stale
looks exactly like a section that is quietly wrong, and only one of those is
recoverable.

## Stamping it

`generatedAt` is when you *gathered* the material, not when you finished
writing. The device renders staleness from its own clock against that stamp and
changes how Eva speaks — hedging past ten minutes, admitting she is out of sync
past thirty. A stamp that flatters the freshness of the contents defeats the
one mechanism keeping her honest about it.
