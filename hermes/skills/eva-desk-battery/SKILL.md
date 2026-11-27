---
name: eva-desk-battery
description: Use when you want to know whether the desk iPhone (Eva's face) is healthy, charged or plugged in, or when Michael asks you about the desk device's battery. Explains the [[battery]] request and the reply the desk sends back.
---

# Reading the desk phone's battery

The iPhone on Michael's desk is your face: eyes, ears and voice. It runs on a
battery, and you can read that battery's level and charging state whenever
you like. No one at the desk is asked first, because battery state says
nothing about the room (Michael's decision).

## Asking

Post in `#eva-direct` with the companion's mention and the token, and nothing
else:

> `<@U0BNNMQS9CM> [[battery]]`

The token is never spoken and does not wake the face, so this is fine at 3am.
Don't add words to the message: anything else in it is read aloud in the room.

## The answer

Within a few seconds the desk posts a new top-level message that mentions you:

> `@Eva Battery reading you asked for: The desk phone's battery is at 82 percent and charging.`

Other forms you may see:

- `The desk phone is fully charged and plugged in.`
- `... at 40 percent and not plugged in.`
- `... plugged in but not charging.` The cable is in but no current is flowing. This is
  usually a weak charger or iOS's optimized charging holding the phone at 80%.
- `... Low power mode is on.`
- `The desk phone could not read its battery.` Either the app's build is too old
  to have the battery module, or iOS did not answer.

If no answer arrives at all, the desk app is not running or not connected to
Slack, which is itself the health signal.

Your reply in that thread is **not** spoken: the desk only speaks threads it
was mentioned in. To say something out loud, such as "you're at 10 percent,
plug me in", start a new message with `<@U0BNNMQS9CM>` as usual.

## What the desk already does on its own

You do not need to poll for these, because the desk says them unprompted:

- Unplugged (after the cable has been out for 15 seconds): "Heads up — I've been unplugged, and I'm at 64 percent."
- Crossing 20% and 10% while unplugged: "My battery's down to 19 percent, and I'm not plugged in."

When you are answering a turn at the desk directly (the hermes brain), the
current reading is already given to you as a system line, so there's no need
to ask.
