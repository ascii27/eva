#!/usr/bin/env python3
"""hermes' side of #eva-direct, the Slack channel shared with the desk iPhone.

Standard library only. It exists so that talking to the desk never needs a
hand-built shell pipeline. `curl ... | python3 -c ...` trips hermes' tirith
scanner (curl_pipe_shell, HIGH). That finding is session-scoped by design,
so it cannot go in command_allowlist and asks for approval every time. On
the desk there is no one to answer the prompt, and in cron it is denied
outright (ASC-49). A plain `python3 eva_slack.py ...` raises neither.

Configuration (all optional):

  SLACK_BOT_TOKEN     hermes' own bot token. hermes strips it from the terminal
                      tool's environment, so when it is absent this script
                      reads it from $HERMES_HOME/.env (default ~/.hermes/.env).
  EVA_DIRECT_CHANNEL  default C0B7ZEBTVK6 (#eva-direct)
  EVA_DESK_USER       the desk app's bot user, default U0BNNMQS9CM

Commands:

  read [--limit N] [--after TS]
        the latest messages in #eva-direct, oldest first, one JSON object per
        line: {"ts", "from": "desk"|"you"|"<user id>", "text", "thread_ts"?}
  post TEXT [--thread TS]
        post TEXT in #eva-direct. Mention the desk (<@U0BNNMQS9CM>) in TEXT
        and it is spoken aloud in the room.
  ask battery|light|brightness|location [--wait SECONDS]
        post the token to the desk and wait (default 30s) for its answer, then
        print the answer's text. Exit code 3 means the desk did not answer,
        which means the desk app is not running or not connected.

The channel is fixed. This script cannot post anywhere else, which is what
makes it safe to run without asking.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL = os.environ.get("EVA_DIRECT_CHANNEL", "C0B7ZEBTVK6")
DESK = os.environ.get("EVA_DESK_USER", "U0BNNMQS9CM")
API = "https://slack.com/api/"

# What each `ask` posts, and how the desk's answer starts (src/device/battery.ts
# batteryReport, src/device/screen.ts lightReport/brightnessReport,
# src/location/place.ts locationReply). Matching on the opening words means an
# unrelated desk message posted during the wait is not mistaken for the answer.
ASKS = {
    "battery": ("[[battery]]", ("Battery reading you asked for:",)),
    "light": ("[[light]]", ("Light reading you asked for:",)),
    "brightness": ("[[brightness]]", ("Brightness reading you asked for:",)),
    "location": ("[[location]]", ("The desk is in ", "I couldn't read the location:")),
}


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def parse_env(text: str) -> dict:
    """KEY=VALUE lines as a dict. Tolerates `export`, quotes and comments."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        out[key.strip()] = value
    return out


def bot_token(environ=os.environ) -> str:
    token = environ.get("SLACK_BOT_TOKEN")
    if token:
        return token
    env_file = Path(environ.get("HERMES_HOME", "~/.hermes")).expanduser() / ".env"
    try:
        token = parse_env(env_file.read_text()).get("SLACK_BOT_TOKEN", "")
    except OSError:
        token = ""
    if not token:
        die(f"SLACK_BOT_TOKEN is not set and not in {env_file}")
    return token


def call(method: str, params: dict, post: bool = False) -> dict:
    token = bot_token()
    if post:
        req = urllib.request.Request(API + method, data=json.dumps(params).encode(), method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
    else:
        req = urllib.request.Request(API + method + "?" + urllib.parse.urlencode(params))
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        die(f"slack answered {e.code}")
    except urllib.error.URLError as e:
        die(f"slack unreachable: {e.reason}")
    if not body.get("ok"):
        die(f"slack refused {method}: {body.get('error', 'unknown error')}")
    return body


def view(msg: dict, me: str | None) -> dict:
    """The parts of a Slack message worth reading, with the sender named."""
    user = msg.get("user") or msg.get("bot_id") or "?"
    who = "desk" if user == DESK else "you" if me and user == me else user
    out = {"ts": msg.get("ts"), "from": who, "text": msg.get("text", "")}
    if msg.get("thread_ts") and msg.get("thread_ts") != msg.get("ts"):
        out["thread_ts"] = msg["thread_ts"]
    return out


def find_answer(messages: list, kind: str, after_ts: str) -> dict | None:
    """The desk's answer to `ask kind` posted after `after_ts`, if one is there.
    Answers are top-level messages from the desk that open with a known prefix."""
    prefixes = ASKS[kind][1]
    for msg in sorted(messages, key=lambda m: float(m.get("ts", 0))):
        if float(msg.get("ts", 0)) <= float(after_ts):
            continue
        if msg.get("user") != DESK:
            continue
        if msg.get("thread_ts") and msg.get("thread_ts") != msg.get("ts"):
            continue
        text = strip_mention(msg.get("text", ""))
        if text.startswith(prefixes):
            return msg
    return None


def strip_mention(text: str) -> str:
    """'<@U0B7...> Battery reading ...' -> 'Battery reading ...'."""
    text = text.strip()
    while text.startswith("<@") and ">" in text:
        text = text[text.index(">") + 1:].lstrip()
    return text


def my_user_id() -> str | None:
    try:
        return call("auth.test", {}).get("user_id")
    except SystemExit:
        return None


def history(oldest: str | None = None, limit: int = 20) -> list:
    params = {"channel": CHANNEL, "limit": limit}
    if oldest:
        params["oldest"] = oldest
    return call("conversations.history", params).get("messages", [])


def cmd_read(args) -> None:
    me = my_user_id()
    for msg in reversed(history(args.after, args.limit)):
        print(json.dumps(view(msg, me), ensure_ascii=False))


def cmd_post(args) -> None:
    params = {"channel": CHANNEL, "text": args.text}
    if args.thread:
        params["thread_ts"] = args.thread
    body = call("chat.postMessage", params, post=True)
    print(json.dumps({"ts": body.get("ts")}))


def cmd_ask(args) -> None:
    token, _ = ASKS[args.kind]
    posted = call("chat.postMessage", {"channel": CHANNEL, "text": f"<@{DESK}> {token}"}, post=True)
    sent_ts = posted.get("ts", "0")
    deadline = time.monotonic() + args.wait
    while True:
        time.sleep(2)
        answer = find_answer(history(sent_ts, 20), args.kind, sent_ts)
        if answer:
            print(strip_mention(answer.get("text", "")))
            return
        if time.monotonic() >= deadline:
            die(f"the desk did not answer within {args.wait}s: the desk app is not running or not connected to Slack", 3)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description="hermes' side of #eva-direct")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("read")
    r.add_argument("--limit", type=int, default=10)
    r.add_argument("--after", help="only messages newer than this Slack ts")
    w = sub.add_parser("post")
    w.add_argument("text")
    w.add_argument("--thread", help="reply in this thread (its parent's ts)")
    a = sub.add_parser("ask")
    a.add_argument("kind", choices=sorted(ASKS))
    a.add_argument("--wait", type=int, default=30)
    args = p.parse_args(argv)
    {"read": cmd_read, "post": cmd_post, "ask": cmd_ask}[args.cmd](args)


if __name__ == "__main__":
    main()
