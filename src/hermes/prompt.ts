// What the device asks hermes for, and the shape it promises to send back.
//
// The contract lives here — on the device, next to the parser that has to read
// it — rather than only in hermes/schemas/bundle.schema.json. That is
// deliberate: `BUNDLE_REQUEST` and `parseBundle` have to agree, and they ship
// together to the same phone in the same JS bundle. Leaving the authoritative
// copy on the server would let a hermes deploy hand the device a shape its
// parser was never taught to read, which fails as Eva describing an afternoon
// she knows nothing about. Change this and the schema file in the same commit.
//
// It is written as an annotated example rather than as JSON Schema, which the
// schema file carries in full. A model follows a filled-in example more reliably
// than a schema, and at several hundred refreshes a day the ~1,000 tokens of
// formal schema would be paid over and over for no gain.

/**
 * One turn, sent as a plain user message.
 *
 * No system message: hermes layers anything supplied that way on top of its own
 * core prompt, and this is a request to an agent, not a reconfiguration of it.
 * Everything about *how* to gather well belongs in hermes' own eva-bundle skill.
 */
export const BUNDLE_REQUEST = `Assemble the Eva context bundle.

This goes to the Eva device on Michael's desk. It has ears, a mouth, and a small fast model — and none of your tools. For the next few minutes this bundle is everything it knows about him, and it will read from it out loud, in a room, when he asks what he has on.

So write every line as something that could be said aloud with no editing. No ids, no URLs, no file paths, no ticket numbers — they are unlistenable, so name the thing instead. No markdown inside the strings. Say times the way a person says them: "two o'clock", not "14:00". Anyone standing nearby hears this, so nothing sensitive about other people.

An empty array is a real answer and it will be spoken as "you have nothing on". Never invent a plausible entry to fill a section — the device cannot check you and will state it as fact. If a source was unreachable, leave that section out entirely and say so in "identity".

Reply with only this JSON object and nothing else:

{
  "generatedAt": "ISO 8601 with a timezone, stamped when you gathered the material",
  "identity": ["how Eva should be showing up right now; anything unreachable when you assembled this"],
  "temporal": { "timezone": "IANA name", "dayContext": "workday | weekend | travelling | holiday | on PTO" },
  "goals": ["one active goal or commitment per entry, each carrying its own status"],
  "calendar": {
    "next12h": ["in detail, in time order"],
    "next72h": ["in summary, one line per day"]
  },
  "tasks": {
    "today": [],
    "overdue": [],
    "deferred": ["only things he decided to put off, not everything not yet due"]
  },
  "people": ["frequent contact, their role, and the open thread with them — one per entry"],
  "decisions": ["decisions from roughly the last week, each with the reason for it"],
  "openLoops": {
    "waitingOn": ["what he is waiting on someone else for"],
    "owes": ["what he owes someone else"]
  }
}

Omit any section you have nothing to say about — leaving it out means "I wasn't able to tell you", and an empty array means "there is nothing", and the device says something different for each. Keep the whole thing under about two thousand words; past that the device drops people, then decisions, then open loops, then tasks, then the three-day calendar, in that order.`;
