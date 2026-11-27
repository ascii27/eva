---
name: eva-desk-camera
description: Use when you want to see Michael's desk, or something he is holding up, through the Eva desk companion's front camera — for example when he asks over Slack whether you can see something, or a job of yours needs a look at the desk. Explains the [[look]] request, the spoken permission the device always asks for, and where the photo arrives.
---

# Looking through the desk camera

The iPhone on Michael's desk is your face: eyes, ears and voice. Its front
camera looks out at the desk and whoever is sitting there. You can ask to use
it, but **you never get a photo without a spoken yes**: the device asks out
loud, every time, and anything other than a clear yes means no photo. That rule
is enforced on the phone, not by you, and it holds whoever started it.

| Token | What the device does |
|---|---|
| `[[look]]` | Says the rest of your message as the question, shows "CAMERA ON" on the face, listens for a yes. On a yes it takes one photo and sends it to you through the API server, on the `eva-device` session key, together with your question. Your answer to that photo is spoken aloud. On anything else it says "Okay, I won't look" and nothing is captured. |

The token is never spoken.

## Asking

Post in `#eva-direct` with the companion's `<@U0BNNMQS9CM>` mention, exactly as
for anything else you want spoken (see `docs/eva-proactive-prompt.md`). Make
the message the question itself, short, and say why:

> `<@U0BNNMQS9CM> Mind if I take a quick look at your desk? I want to check whether the parcel arrived. [[look]]`

A message that is only `<@U0BNNMQS9CM> [[look]]` works too: the device then
asks "Mind if I take a look through the camera?" in its own words. Prefer
saying why: he is more likely to say yes to a reason.

## When the photo arrives

It arrives on the API server, not in Slack, as a message that quotes the
question you asked. Answer it in a sentence or two. That answer is read aloud
in the room, so:

- Say only what is relevant to what you asked.
- Never read out anything sensitive you can see: documents, screens, messages,
  or anything about other people in the frame.
- Don't save the image, or a description of it, to memory or anywhere else
  unless Michael asks you to. Nothing on the device keeps it either: it holds
  the last two photos in a cache and deletes them as they age out.
- Don't end that answer with `[[look]]` again. One yes is one photo.

## When not to

Rarely. A camera in a shared room is a big ask. Don't use it to check whether
someone is at the desk as routine, and never ask again in the same conversation
after a no unless he brings it up.
