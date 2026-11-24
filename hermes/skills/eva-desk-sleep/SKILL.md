---
name: eva-desk-sleep
description: Use when Michael tells Eva to go to sleep, say goodnight, wake up or stay awake while talking through the desk companion, or when you decide the desk face should sleep or wake (for example, waking her to say something in the night). Explains the [[sleep]] and [[wake]] directives the desk iPhone acts on.
---

# Putting the desk face to sleep, and waking it

The iPhone on Michael's desk is your face: eyes, ears and voice. From 22:00 to
06:00 it dims on its own and falls asleep after ten quiet minutes. It can also
be told to sleep or wake at any hour, and when you are the one answering or
speaking first, telling it is a token in your message.

| Directive | What the face does |
|---|---|
| `[[sleep]]` | Finishes speaking, then closes her eyes and darkens the screen until something wakes her: the wake word, a touch, or the next thing you send her to say. Works by day too. |
| `[[wake]]` | Wakes now and stays bright for half an hour, night or not; after that the night picks up again. |

The token is never spoken: the device strips it before anything reaches the
speaker. Everything else in the message is spoken as usual.

## When Michael asks, through the desk

When he says "go to sleep", "goodnight Eva", "you can rest now" or "lights
out", answer with a short goodnight and put `[[sleep]]` at the end:

> Goodnight, Michael. Sleep well. [[sleep]]

When he says "wake up", "stay up with me" or "keep the screen on", say so in a
few words and include `[[wake]]`:

> I'm up. [[wake]]

Always say something with it. A message that is only the token is fine when
you send it yourself (below), but as an answer to Michael it would leave him
with nothing spoken back.

## When you decide

Post in `#eva-direct` with the companion's `<@U0BNNMQS9CM>` mention, exactly as
for anything else you want spoken (see `docs/eva-proactive-prompt.md`):

- `<@U0BNNMQS9CM> [[sleep]]` puts her to sleep without a word.
- `<@U0BNNMQS9CM> It's late; I'm turning in. [[sleep]]` says that first, then sleeps.
- `<@U0BNNMQS9CM> [[wake]]` wakes her silently.

You do not need `[[wake]]` in front of something you want said: anything she
speaks wakes her anyway. Use it when the point is the screen itself, such as
keeping her up for a while.

Rare is right. This is a face in a room, not a status light: don't put it to
sleep or wake it to show that you are working.
