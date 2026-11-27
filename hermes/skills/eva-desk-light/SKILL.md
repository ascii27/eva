---
name: eva-desk-light
description: Use when you want to know how dark or bright the room at Michael's desk is, before speaking aloud at night, or when you want to read or change the desk iPhone's screen brightness (dim it at bedtime, brighten it in the morning, or because Michael asked). Explains the [[light]] and [[brightness]] tokens and the replies the desk sends back.
---

# The desk's room light and screen brightness

The iPhone on Michael's desk is your face. You can measure how much light is in
the room and read or set how bright the screen is, whenever you like. No one at
the desk is asked first (Michael's decision, Nov 27).

## Measuring the room's light

iPhones give apps no ambient light sensor, so the desk uses its front camera as
a light meter: it takes one frame, reads the exposure, and deletes it. Nothing
in the frame is looked at or kept. The iOS camera indicator lights for about a
second, so don't measure on a timer — measure when the answer changes what you
do, such as before saying something out loud late at night.

Post in `#eva-direct` with the companion's mention and the token, and nothing
else:

> `<@U0BNNMQS9CM> [[light]]`

Within a few seconds the desk posts a new top-level message that mentions you:

> `@Eva Light reading you asked for: The room at the desk is dark, about 3 lux, measured just now. The desk phone's screen is at 10 percent brightness.`

The room is one of: dark, dimly lit, lit like a normal indoor room, brightly
lit, or in full daylight. The lux figure is rough, good to within a factor of
two. "Dark" means the lights are off: if it's late and dark, Michael is probably
asleep or gone, so think twice before a message that will be spoken aloud.

If the camera is busy (Michael is showing it something) or camera access was
never allowed, the reply says so instead of giving a reading.

## Reading the screen brightness

> `<@U0BNNMQS9CM> [[brightness]]`

The answer is `Brightness reading you asked for: The desk phone's screen is at 40 percent brightness.`

## Setting the screen brightness

Put `[[brightness N]]`, where N is a percent from 1 to 100, in a message to the
desk. It is a command, not a reading: the desk sets the screen and posts back
what changed.

> `<@U0BNNMQS9CM> [[brightness 15]]`

> `@Eva Brightness changed as you asked: The desk phone's screen was 60 percent and is now at 15 percent brightness. It stays there until ten at night, when the night schedule takes over, or until the face falls asleep.`

The token is never spoken, and a message with only the token doesn't wake the
face. You can also put it in a message that is spoken, such as "Getting late,
I'll dim down. [[brightness 10]]".

When you are answering a turn at the desk directly (the hermes brain), end your
spoken reply with the token in the same way. You are given the current
brightness, and the last light reading if there is one, as a system line on
every turn, so a request like "a bit dimmer" can be worked out from that.

## How it shares the screen with the night schedule

The face dims on its own from 22:00 to 06:00 and goes darker when it falls
asleep. A level you or Michael set holds until the next of those two edges
(22:00 or 06:00), through talking and dimming, so "dim the screen" at 23:00
stays dim. When the face falls asleep the screen goes dark anyway. At 06:00 the
daytime level comes back. A level set during the day becomes the daytime
level.
