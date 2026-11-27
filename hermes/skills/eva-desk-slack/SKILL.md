---
name: eva-desk-slack
description: Use whenever you need to read or post in #eva-direct, the Slack channel shared with the desk iPhone (Eva Companion). Covers checking the desk's battery, light, brightness or location and reading its reply, saying something out loud at the desk, and reading what the desk posted. Use the script here; never call the Slack API with curl.
---

# Talking to the desk over #eva-direct

The iPhone on Michael's desk (Eva Companion, `<@U0BNNMQS9CM>`) and you share one
Slack channel, `#eva-direct`. Everything you do in it goes through one script:

`~/.hermes/skills/eva-desk-slack/scripts/eva_slack.py` (Python standard library only)

```bash
python3 ~/.hermes/skills/eva-desk-slack/scripts/eva_slack.py ask battery     # or light, brightness, location
python3 ~/.hermes/skills/eva-desk-slack/scripts/eva_slack.py read --limit 10
python3 ~/.hermes/skills/eva-desk-slack/scripts/eva_slack.py post "<@U0BNNMQS9CM> Michael, it's half past eleven."
```

## Why not curl

Don't build Slack requests by hand: no `curl`, no grepping `.env` for the token,
and no piping into `python3 -c`. hermes' command scanner flags `curl | python3`
as a pipe to an interpreter. That check can't be allowlisted, so it asks for
approval every time. On the desk nobody sees the prompt, because Michael is
talking, not watching a screen. In a cron job it is simply denied. The script
reads the token itself and can only reach `#eva-direct`, so it runs without
asking.

## ask: a reading from the desk

`ask KIND` posts `<@U0BNNMQS9CM> [[KIND]]` (only the token, so nothing is spoken
and the face stays asleep). It waits up to 30 seconds (`--wait N` to change
that) for the desk's answer, then prints it:

```
$ python3 eva_slack.py ask battery
Battery reading you asked for: The desk phone's battery is at 82 percent and charging.
```

| KIND | What comes back | More in |
|---|---|---|
| `battery` | level, charging, low power mode | `eva-desk-battery` |
| `light` | how bright the room is (flashes the camera indicator, so not on a timer) | `eva-desk-light` |
| `brightness` | the screen's brightness | `eva-desk-light` |
| `location` | the town the desk is in | `eva-desk-location` |

Exit code 3 with "the desk did not answer" means the desk app is not running
or not connected to Slack. That is itself the health signal, so report it
rather than retrying in a loop.

## post: saying something

`post TEXT` posts TEXT in `#eva-direct`. With `<@U0BNNMQS9CM>` in it, the desk
reads it **aloud** in the room, so write it for the ear. Without the mention it
is just a note in the channel. `--thread TS` replies in a thread. To set the
screen brightness, post `<@U0BNNMQS9CM> [[brightness 15]]`; the desk's report
then shows up in `read`.

## read: what's in the channel

`read` prints the latest messages oldest first, one JSON object per line, with
`from` set to `desk`, `you`, or a Slack user id. `--after TS` shows only what
came after a message you posted (the `ts` that `post` printed).
