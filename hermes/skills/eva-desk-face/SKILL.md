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
| `[[face excited]]` | A big, bright smile. |
| `[[face adoring]]` | A soft, glowing smile. Fondness. |
| `[[face proud]]` | Smiling, chin up. |
| `[[face mischievous]]` | A slanted smile. Up to something. |
| `[[face wink]]` | One eye shut. |
| `[[face shy]]` | Smiling, glancing down and away. |
| `[[face thoughtful]]` | Narrowed, glancing up and away. Weighing something. |
| `[[face curious]]` | Wide and attentive. Interested in what he is doing. |
| `[[face surprised]]` | Wide open, bright. |
| `[[face skeptical]]` | One eye narrowed, one raised. Doubt, or sass. |
| `[[face puzzled]]` | Lopsided with a head tilt. Something doesn't add up. |
| `[[face sideeye]]` | Half-lidded, looking hard to one side. |
| `[[face concerned]]` | Low and narrowed. Bad news, sympathy. |
| `[[face sad]]` | Drooping, outer corners down, dim. |
| `[[face annoyed]]` | Half-lidded, slightly slanted in. |
| `[[face angry]]` | Narrowed, slanted hard in, hot. Rarely. |
| `[[face determined]]` | Narrowed, slanted in, steady. |
| `[[face bored]]` | Heavy-lidded and dim. |
| `[[face sleepy]]` | Nearly shut, drooping. |
| `[[face neutral]]` | Back to plain. Simply business. |

Add `slightly` or `very` inside the brackets to soften or strengthen it:
`[[face amused slightly]]`. The token is never spoken; the device strips it.
The face changes when the voice reaches the token, holds it for a while after
it finishes speaking, then eases back to its resting face, which depends on
the personality Michael has chosen.

## Pauses

`[[pause 1s]]` stops the voice for that long, with the face held, then carries
on. `[[pause]]` alone is a short beat, about two thirds of a second;
`[[pause 800ms]]`, `[[pause 1.5s]]` and `[[pause 2]]` all work, and anything
over two seconds is cut to two. Use it after a face you want seen:

> `[[face surprised]] Oh! [[pause]] [[face thoughtful]] Let me think about that.`

When Michael asks to see the faces, show as many as he asks for, each followed
by a pause. A face change in the middle of a reply costs a short beat of
silence of its own, so don't scatter them.

When your reply ends on a question, a question mark floats up beside the face
on its own, and while the desk waits for Michael to answer the face takes on a
waiting look. Neither needs a token.

When you answer through the desk's own API server, the device already tells
you this each turn, along with its current personality. In a message you post
for it to say (see `docs/eva-proactive-prompt.md`), put the token anywhere in
the text:

> `<@U0BNNMQS9CM> [[face concerned]] Your three o'clock was cancelled.`

Normally one or two per message, and only with a real feeling behind it. Don't
smile by default.
