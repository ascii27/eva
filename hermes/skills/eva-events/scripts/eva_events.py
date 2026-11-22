#!/usr/bin/env python3
"""Tokyo events the family asked for from the kitchen board (eva-board.exe.xyz).

On the board, someone taps a Tokyo event and "Ask Eva to add it" (or "Take it
off"). The board records that as a *plan* and waits; this script is how you
read the plans and say what you did. The calendar itself is yours, through your
own calendar tools. Standard library only. Configuration comes from the
environment:

  WALLBOARD_TOKEN   the board's HERMES_TOKEN (required)
  WALLBOARD_URL     default https://eva-board.exe.xyz

Commands:

  pending                    plans waiting for you, oldest first, each with the
                             calendar entry to make (or to remove), as JSON
  list                       every plan the board holds (pending, done, failed)
  done ID --want add|remove [--ref CALENDAR_ID]
                             the calendar now matches: added (pass the entry's
                             id as --ref) or removed
  failed ID --want add|remove --note 'why'
                             you couldn't; the board shows the note and offers
                             a retry

`--want` is the want you read from `pending`. If the family changed their mind
since (tapped "Take it off" while an add was waiting), the board refuses the
report (exit 3): run `pending` again and act on what it says now.
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ.get("WALLBOARD_URL", "https://eva-board.exe.xyz").rstrip("/")
TOKYO = dt.timezone(dt.timedelta(hours=9))
NOTE_MAX = 200
# An event with a start time but no end gets this long on the calendar.
DEFAULT_MINUTES = 120
# Longer than this is opening hours (an exhibition open 10:00-22:00), not a
# show: it goes on the calendar as all-day with the hours in the notes, rather
# than as a 12-hour block on the family's Today card.
OPEN_HOURS_MINUTES = 6 * 60


class Stale(Exception):
    """The board answered 409: the plan changed since it was read."""


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
        text = e.read().decode(errors="replace")[:300]
        if e.code == 409:
            raise Stale(text)
        die(f"board answered {e.code}: {text}")
    except urllib.error.URLError as e:
        die(f"board unreachable: {e.reason}")


def hm(day: str, t: str) -> dt.datetime:
    h, m = t.split(":")
    y, mo, d = (int(x) for x in day.split("-"))
    return dt.datetime(y, mo, d, int(h), int(m), tzinfo=TOKYO)


def calendar_entry(plan: dict) -> dict:
    """The calendar entry for a plan, ready to hand to a calendar tool.

    Timed when the event page gave a start time and it's a show-length span;
    all-day when there's no time, or when the span is really opening hours
    (longer than OPEN_HOURS_MINUTES), with the hours in the notes. Tokyo time.
    """
    day = plan["day"]
    entry = {"title": plan["title"]}
    hours = None
    if plan.get("time"):
        start = hm(day, plan["time"])
        end = hm(day, plan["until"]) if plan.get("until") else start + dt.timedelta(minutes=DEFAULT_MINUTES)
        if end <= start:  # "18:00–01:00" style: runs past midnight
            end += dt.timedelta(days=1)
        if end - start > dt.timedelta(minutes=OPEN_HOURS_MINUTES):
            hours = f"Open {plan['time']}–{plan['until']}"
        else:
            entry.update(allDay=False, start=start.isoformat(), end=end.isoformat())
    if "start" not in entry:
        entry.update(allDay=True, date=day)
    location = ", ".join(x for x in (plan.get("venue"), plan.get("place")) if x)
    if location:
        entry["location"] = location
    entry["notes"] = "\n".join(x for x in (hours, plan["url"], "Added from the kitchen board.") if x)
    return entry


def view(plan: dict) -> dict:
    """What `pending` prints for one plan: the request, plus the entry to make or find."""
    out = {
        "id": plan["id"],
        "want": plan["want"],
        "day": plan["day"],
        "weekday": dt.date.fromisoformat(plan["day"]).strftime("%A"),
        "entry": calendar_entry(plan),
        "ref": plan.get("ref"),
        "status": plan["status"],
    }
    if plan.get("note"):
        out["last_note"] = plan["note"]
    return out


def plans() -> list:
    return call("GET", "/api/eva/plans").get("plans") or []


def cmd_pending(_args) -> None:
    print(json.dumps([view(p) for p in plans() if p.get("status") == "pending"], ensure_ascii=False, indent=2))


def cmd_list(_args) -> None:
    print(json.dumps([view(p) for p in plans()], ensure_ascii=False, indent=2))


def report(plan_id: str, body: dict) -> None:
    try:
        r = call("PUT", f"/api/eva/plans/{urllib.parse.quote(plan_id, safe='')}", body)
    except Stale:
        die("the family changed this plan since you read it. Nothing was recorded; run `pending` again and act on what it says now.", 3)
    print(json.dumps({"ok": True, "recorded": body, "duplicate": bool(r.get("duplicate"))}, ensure_ascii=False))


def cmd_done(args) -> None:
    body = {"want": args.want, "result": "done"}
    if args.ref:
        body["ref"] = args.ref
    report(args.id, body)


def cmd_failed(args) -> None:
    note = " ".join((args.note or "").split())
    if not note:
        die("--note is required: say in a few words why, for the family to read on the board", 2)
    if len(note) > NOTE_MAX:
        die(f"--note is {len(note)} characters; the limit is {NOTE_MAX}. Shorten it; nothing was sent.", 2)
    report(args.id, {"want": args.want, "result": "failed", "note": note})


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("pending").set_defaults(fn=cmd_pending)
    sp.add_parser("list").set_defaults(fn=cmd_list)
    d = sp.add_parser("done")
    d.add_argument("id")
    d.add_argument("--want", choices=["add", "remove"], required=True)
    d.add_argument("--ref")
    d.set_defaults(fn=cmd_done)
    f = sp.add_parser("failed")
    f.add_argument("id")
    f.add_argument("--want", choices=["add", "remove"], required=True)
    f.add_argument("--note", required=True)
    f.set_defaults(fn=cmd_failed)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
