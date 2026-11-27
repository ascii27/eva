---
name: eva-desk-location
description: Use when you need to know which town or city Michael's desk (and the desk iPhone, Eva's face) is in — for local weather, nearby events, travel times, or because someone asked where Eva is. Explains the [[location]] request and how the desk answers it.
---

# Asking the desk where it is

The iPhone on Michael's desk knows which town it is in. It never knows more
than that on your behalf: it keeps the town, never coordinates or an address.

## How to ask

Post in `#eva-direct` with the companion's `<@U0BNNMQS9CM>` mention and the
`[[location]]` token, exactly as for `[[battery]]`:

> <@U0BNNMQS9CM> [[location]]

The token is never spoken and the face is not woken: the desk answers on its
own. Any other words in the message are spoken as usual.

The quickest way is `python3 ~/.hermes/skills/eva-desk-slack/scripts/eva_slack.py ask location`,
which posts the token, waits for the desk's answer and prints it. Never call
the Slack API with curl: it asks for approval every time, and at the desk or in
cron there is nobody to approve it (see `eva-desk-slack`).

## What comes back

A new message in the channel, addressed to you, within a few seconds:

| Reply | Meaning |
|---|---|
| `The desk is in <Town>, <Region>.` | That is the whole answer. |
| `I couldn't read the location: …` | No town has been set yet and the phone couldn't get one — usually because location access hasn't been granted on the desk. Michael can set it from the desk's debug overlay. |

## Rules

- Ask only when the answer actually depends on it.
- The desk rarely moves. Once you have the town, remember it rather than asking
  again; ask again only when something suggests it has moved.
- Never repeat the town back with more precision than you were given, and never
  guess a street or address from it.
