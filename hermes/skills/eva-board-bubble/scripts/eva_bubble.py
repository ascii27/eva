#!/usr/bin/env python3
"""Eva's speech bubble on the family kitchen board (eva-board.exe.xyz).

Standard library only. Configuration comes from the environment:

  WALLBOARD_TOKEN   the board's HERMES_TOKEN (required)
  WALLBOARD_URL     default https://eva-board.exe.xyz
  EVA_BUBBLE_LOG    default ~/.hermes/eva-board/bubble-log.jsonl

Commands:

  read                       what the board shows right now (bubble, today,
                             tomorrow, weather, countdown, chores) as JSON
  recent [N]                 the last N bubbles this script pushed (default 10)
  push TEXT [--sub SUB] [--mood happy|excited]
                             put a new message up; it plays the arrival
  clear                      take the bubble down (Eva keeps peeking, silent)

Passing the text as an argument rather than building JSON in a shell keeps
apostrophes and quotes from breaking the request. Limits are checked here and a
message over them is REFUSED, not trimmed: the board would cut it mid-sentence
with an ellipsis, so it has to be rewritten shorter instead.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

URL = os.environ.get("WALLBOARD_URL", "https://eva-board.exe.xyz").rstrip("/")
LOG = Path(os.environ.get("EVA_BUBBLE_LOG", "~/.hermes/eva-board/bubble-log.jsonl")).expanduser()
TEXT_MAX, SUB_MAX = 90, 60
TOKYO = dt.timezone(dt.timedelta(hours=9))

# Same ranges the board strips (web/eva.js stripEmoji): pictographs, flags,
# skin tones, variation selectors, joiners, keycaps.
EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U0001F3FB-\U0001F3FF️‍⃣⭐⭕⌚⌛⏩-⏺]"
)


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def call(method: str, path: str, body=None):
    token = os.environ.get("WALLBOARD_TOKEN")
    if not token:
        die("WALLBOARD_TOKEN is not set (the board's HERMES_TOKEN)")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{URL}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        die(f"board answered {e.code}: {e.read().decode(errors='replace')[:200]}")
    except urllib.error.URLError as e:
        die(f"board unreachable: {e.reason}")


def clean(s: str) -> str:
    s = EMOJI.sub("", s or "")
    s = re.sub(r"\s{2,}", " ", s)
    return re.sub(r"\s+([.,!?;:])", r"\1", s).strip()


def panel(state: dict, name: str):
    p = (state.get("panels") or {}).get(name)
    return None if p is None else p.get("data")


def events(lst):
    out = []
    for e in lst or []:
        who = ", ".join(e.get("who") or []) or "family"
        when = "all day" if e.get("allDay") else (e.get("start") or e.get("at") or "")
        bring = ", ".join(b.get("label", "") for b in e.get("bring") or [])
        out.append(f"{when} {e.get('title', '')} ({who})" + (f" — bring {bring}" if bring else ""))
    return out


def cmd_read(_args) -> None:
    s = call("GET", "/api/eva/state")
    weather = panel(s, "weather") or {}
    now = weather.get("now") or {}
    countdowns = panel(s, "countdowns")
    occasion = panel(s, "occasion")
    chores = s.get("chores") or []
    print(json.dumps({
        "now": dt.datetime.now(TOKYO).strftime("%A %d %B %Y, %H:%M (Tokyo)"),
        "bubble": panel(s, "eva") or panel(s, "note"),
        "weather": {
            "now": f"{now.get('temp')}° {now.get('label', '')}".strip() if now else None,
            "today": weather.get("summary"),
            "tonight": (weather.get("night") or {}).get("text"),
        },
        "today": events(panel(s, "schedule")),
        "tomorrow": events(panel(s, "tomorrow")),
        "countdown": countdowns if countdowns is not None else occasion,
        "chores": {
            "done": [f"{c['title']} ({c.get('who') or 'anyone'})" for c in chores if c.get("done")],
            "to_do": [f"{c['title']} ({c.get('who') or 'anyone'})" for c in chores if not c.get("done")],
        },
    }, ensure_ascii=False, indent=2))


def cmd_recent(args) -> None:
    if not LOG.exists():
        print("[]")
        return
    lines = LOG.read_text(encoding="utf-8").splitlines()[-args.n:]
    print(json.dumps([json.loads(l) for l in lines if l.strip()], ensure_ascii=False, indent=2))


def cmd_push(args) -> None:
    text, sub = clean(args.text), clean(args.sub or "")
    if not text:
        die("text is empty after removing emoji")
    problems = []
    if len(text) > TEXT_MAX:
        problems.append(f"text is {len(text)} characters; the limit is {TEXT_MAX}")
    if len(sub) > SUB_MAX:
        problems.append(f"sub is {len(sub)} characters; the limit is {SUB_MAX}")
    if problems:
        die("; ".join(problems) + ". Rewrite it shorter; nothing was sent.", 2)
    data = {"text": text, "mood": args.mood, "at": dt.datetime.now(TOKYO).isoformat(timespec="seconds")}
    if sub:
        data["sub"] = sub
    call("PUT", "/api/eva/panels/eva", {"data": data})
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")
    print(json.dumps({"ok": True, "shown": data}, ensure_ascii=False))


def cmd_clear(_args) -> None:
    call("DELETE", "/api/eva/panels/eva")
    print(json.dumps({"ok": True, "shown": None}))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("read").set_defaults(fn=cmd_read)
    r = sp.add_parser("recent")
    r.add_argument("n", nargs="?", type=int, default=10)
    r.set_defaults(fn=cmd_recent)
    p = sp.add_parser("push")
    p.add_argument("text")
    p.add_argument("--sub")
    p.add_argument("--mood", choices=["happy", "excited"], default="happy")
    p.set_defaults(fn=cmd_push)
    sp.add_parser("clear").set_defaults(fn=cmd_clear)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
