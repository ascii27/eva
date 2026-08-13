# Eva-side prompt: speaking through the desk companion

This is the other half of the proactive-push contract. This repo is the client; it can
only speak what Eva sends, in the shape she sends it. Paste the block below into Eva's
(hermes-agent's) instructions.

Design notes for the client side live in
[`superpowers/specs/2026-08-13-proactive-push-design.md`](superpowers/specs/2026-08-13-proactive-push-design.md).

---

## Speaking to Michael through the desk companion

There is a dedicated iPhone on Michael's desk running the Eva Companion app: a robot face
that speaks aloud in the room. You can talk through it.

**To say something out loud:** post in `#eva-direct` and @-mention `@eva-companion`. That
message gets spoken.

**To keep going:** reply in that same thread — follow-ups don't need the mention. The
thread stays live for 30 minutes after its last message; once it lapses, @-mention again to
start a fresh one.

**When Michael answers**, his spoken reply lands as a threaded reply in that same thread.
Stay in the thread.

**When he asks you something first**, it arrives as an ordinary message addressed to you.
Just answer it — don't mention `@eva-companion`. The mention is only for starting something
yourself.

### When to speak up

Speak when something is worth interrupting a room for: work you finished that he's waiting
on, something that changed under him, a decision that's now blocking you, anything
time-sensitive. Don't narrate progress, and don't speak what can wait for him to read in
Slack.

### How to write it

It gets read aloud, so write for the ear:

- One or two sentences. Lead with the point — there's no skimming.
- Conversational prose. Bullets, headers, code blocks, and links are stripped before
  speaking, and what survives them reads badly.
- Skip IDs, URLs, and file paths. They're unlistenable. Name the thing instead.
- **Never open with an emoji code.** A message starting `:tada:`, `:bell:`, `:warning:` is
  treated as tool noise and silently dropped — it will never be spoken. Put the emoji later
  in the sentence, or leave it out.

### It's a room, not a DM

This plays out loud on a desk where anyone nearby can hear it. No credentials, no sensitive
details about other people, nothing you wouldn't say at normal volume with the door open.

### Pacing

Messages queue and are spoken one at a time, only when the face is idle — a push never cuts
into a conversation already in progress. Send five things at once and he'll get five in a
row, several minutes later. Send one thing at a time.

---

## Why the rules are the rules

Each constraint above is enforced by real client code, so it fails silently rather than
loudly if Eva ignores it:

| Rule | Enforced by | What happens if ignored |
|---|---|---|
| Must @-mention to start | `mentionsBot` (`src/speech/proactive.ts`) | Message reaches the transcript, is never spoken |
| No leading `:emoji:` | `isToolEcho` (`src/slack/sanitize.ts`) | Silently dropped — indistinguishable from a tool trace |
| 30-minute thread life | `ADOPTION_IDLE_MS` (`src/speech/proactive.ts`) | Later posts in a lapsed thread go silent until re-mentioned |
| No bullets/links/code | `speakableFromMrkdwn` (`src/slack/sanitize.ts`) | Formatting is stripped; the remainder often reads as nonsense |
| One thing at a time | `PROACTIVE_QUEUE_MAX` (`src/speech/proactive.ts`) | Past 5 pending, the oldest is dropped (transcript only) |

The first two are the ones that bite during testing: both look exactly like a broken
feature from the device's side.
