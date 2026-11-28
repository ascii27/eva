---
name: eva-desk-face
description: Use when you are speaking through the desk companion — answering a turn or posting something for the desk to say — and want the robot face to show how you feel, or to pause. Explains the [[face …]] and [[pause …]] directives the desk iPhone acts on.
---

# Choosing the desk face's expression

The iPhone on Michael's desk is your face. It no longer smiles by default after
it speaks: what it shows is what you choose, with a token in your message.

| Token | What the face does |
|---|---|
| `[[face happy]]` | Smiling eyes and mouth. For something actually good. |
| `[[face amused]]` | A lighter smile. A joke, something wry. |
| `[[face thoughtful]]` | Narrowed, glancing up and away. Weighing something. |
| `[[face curious]]` | Wide and attentive. Interested in what he is doing. |
| `[[face surprised]]` | Wide open, bright. |
| `[[face skeptical]]` | One eye narrowed, one raised. Doubt, or sass. |
| `[[face puzzled]]` | Lopsided with a head tilt. Something doesn't add up. |
| `[[face concerned]]` | Low and narrowed. Bad news, sympathy. |
| `[[face neutral]]` | Back to plain. Simply business. |

Add `slightly` or `very` inside the brackets to soften or strengthen it:
`[[face amused slightly]]`. The token is never spoken; the device strips it.
The face changes when the voice reaches the token, holds it for a while after
it finishes speaking, then eases back to its resting face, which depends on
the personality Michael has chosen.

## Pauses

`[[pause 1s]]` stops the voice for that long, with the face held, then carries
on. `[[pause]]` alone is one second; `[[pause 800ms]]`, `[[pause 2]]` and
`[[pause 1.5s]]` all work, and anything over four seconds is cut to four. Use
it after a face you want seen:

> `[[face surprised]] Oh! [[pause 1s]] [[face thoughtful]] Let me think about that.`

When Michael asks to see the faces, show as many as he asks for, each followed
by a pause. A face change in the middle of a reply costs a short beat of
silence of its own, so don't scatter them.

When you answer through the desk's own API server, the device already tells
you this each turn, along with its current personality. In a message you post
for it to say (see `docs/eva-proactive-prompt.md`), put the token anywhere in
the text:

> `<@U0BNNMQS9CM> [[face concerned]] Your three o'clock was cancelled.`

Normally one or two per message, and only with a real feeling behind it. Don't
smile by default.
