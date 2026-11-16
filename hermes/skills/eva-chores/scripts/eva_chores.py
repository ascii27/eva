#!/usr/bin/env python3
"""The deterministic half of Eva's chores ledger (family kitchen board).

hermes copies chore activity from the board into a Notion ledger using its own
Notion tools. This script talks ONLY to the board's HTTP API and prints exact
Notion rows; it never touches Notion or Todoist. All money arithmetic and row
shaping lives here so the agent can copy the output verbatim.

Standard library only. Configuration comes from the environment:

  WALLBOARD_TOKEN   the board's HERMES_TOKEN (required)
  WALLBOARD_URL     default https://eva-board.exe.xyz

Commands (JSON on stdout; errors on stderr, exit 1):

  activity [--log-id ID --after SEQ]
                             new board events as ledger rows, oldest first:
                             {"alarm", "rows", "cursor"}. On an alarm (the board's
                             log was replaced, or its seq went backwards) rows is
                             [] and cursor is the OLD one; tell Michael, don't copy.
  push-chores                JSON array of chore rows on stdin (Notion property
                             names) -> replaces the board's chore list
  balances                   {who: {owed, earned, paid, lastPaid}}
  pay WHO AMOUNT [--note TEXT] [--id ID]
                             record a payment (negative AMOUNT = credit); a repeat
                             of the same --id is a no-op reported as duplicate
  new-chore-id NAME [--taken ID ...]
                             a free chore-<slug> id for a new chore
"""

import argparse
import datetime as dt
import json
import os
import re
import secrets
import sys
import unicodedata
import urllib.error
import urllib.request

URL = os.environ.get("WALLBOARD_URL", "https://eva-board.exe.xyz").rstrip("/")
TOKYO = dt.timezone(dt.timedelta(hours=9))
PEOPLE = {"mariko": "Mariko", "sarina": "Sarina", "nozomi": "Nozomi", "michael": "Michael"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---- pure -------------------------------------------------------------------

def display_name(who: str) -> str:
    return PEOPLE.get(who, who.capitalize())


def tokyo_iso(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, TOKYO).isoformat(timespec="seconds")


def ledger_row(ev: dict, log_id: str) -> dict:
    """One board event as a Notion ledger row. "Amount ¥" is the event's signed
    delta, so the sum per person is what the board owes them."""
    kind = ev["type"]
    payment = kind == "payment"
    return {
        "Event id": ev["id"],
        "Type": kind,
        "Who": display_name(ev["who"]),
        "Chore": ev.get("title") or "",
        "Chore id": ev.get("choreId") or "",
        "Amount ¥": ev["delta"],
        "At": tokyo_iso(ev["at"]),
        "Cancels": (ev.get("cancels") or "") if kind == "undone" else "",
        "Source": (ev.get("source") or "") if payment else "",
        "Note": (ev.get("note") or "") if payment else "",
        "Board log id": log_id,
    }


def check(cursor, resp: dict):
    """An alarm when the board's log is not the one the cursor was taken from."""
    if not cursor:
        return None
    found = {"logId": resp["logId"], "seq": resp["seq"]}
    if resp["logId"] != cursor["logId"]:
        return {"kind": "log-replaced", "expected": cursor, "found": found}
    if resp["seq"] < cursor["seq"]:
        return {"kind": "seq-went-back", "expected": cursor, "found": found}
    return None


def _int(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def chore_defs(rows: list):
    """Notion chore rows -> board ChoreDefs, or the first error as a string."""
    by_name = {v.lower(): k for k, v in PEOPLE.items()}
    out, seen = [], set()
    for i, r in enumerate(rows):
        if r.get("Active") is not True:
            continue
        cid = r.get("Board id")
        label = f"row {i + 1}"
        if not isinstance(cid, str) or not cid.strip():
            return f'{label}: "Board id" missing'
        cid = cid.strip()
        label = f"{label} ({cid})"
        if not ID.match(cid):
            return f'{label}: "Board id" must match {ID.pattern}'
        if cid in seen:
            return f'{label}: duplicate board id "{cid}"'
        seen.add(cid)
        name = r.get("Name")
        if not isinstance(name, str) or not name.strip():
            return f'{label}: "Name" missing'
        who_raw = r.get("Who")
        who_raw = who_raw.strip() if isinstance(who_raw, str) else who_raw
        if who_raw in (None, "") or (isinstance(who_raw, str) and who_raw.lower() == "anyone"):
            who = None
        elif isinstance(who_raw, str) and who_raw.lower() in by_name:
            who = by_name[who_raw.lower()]
        else:
            return f'{label}: unknown "Who" {who_raw!r}'
        amount = _int(r.get("Amount ¥"))
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
            return f'{label}: "Amount ¥" must be an integer >= 0, got {amount!r}'
        every = _int(r.get("Every"))
        if isinstance(every, bool) or not isinstance(every, int) or every < 1:
            return f'{label}: "Every" must be an integer >= 1, got {every!r}'
        unit = r.get("Unit")
        unit = unit.strip().lower() if isinstance(unit, str) else unit
        if unit not in ("day", "week"):
            return f'{label}: "Unit" must be day or week, got {r.get("Unit")!r}'
        start = r.get("Start")
        start = start[:10] if isinstance(start, str) else start
        try:
            if not isinstance(start, str) or not DAY.match(start):
                raise ValueError
            dt.date.fromisoformat(start)
        except ValueError:
            return f'{label}: "Start" must be a YYYY-MM-DD date, got {r.get("Start")!r}'
        icon = r.get("Icon")
        icon = icon.strip().lower() if isinstance(icon, str) else ""
        out.append({
            "id": cid,
            "title": name.strip(),
            "who": who,
            "icon": icon or None,
            "amount": amount,
            "schedule": {"every": every, "unit": unit, "start": start},
        })
    return out


def new_chore_id(name: str, taken: set) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:50].strip("-")
    if slug:
        base = f"chore-{slug}"
        if base not in taken:
            return base
        n = 2
        while f"{base}-{n}" in taken:
            n += 1
        return f"{base}-{n}"
    n = 1
    while f"chore-{n}" in taken:
        n += 1
    return f"chore-{n}"


# ---- I/O --------------------------------------------------------------------

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


def out(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_activity(args) -> None:
    if (args.log_id is None) != (args.after is None):
        die("--log-id and --after go together (the cursor from the last run)")
    cursor = None if args.log_id is None else {"logId": args.log_id, "seq": args.after}
    resp = call("GET", f"/api/eva/activity?after={args.after or 0}")
    alarm = check(cursor, resp)
    if alarm:
        out({"alarm": alarm, "rows": [], "cursor": cursor})
        return
    rows = [ledger_row(e, resp["logId"]) for e in resp["events"]]
    seq = max([resp["seq"]] + [e["seq"] for e in resp["events"]])
    out({"alarm": None, "rows": rows, "cursor": {"logId": resp["logId"], "seq": seq}})


def cmd_push_chores(_args) -> None:
    try:
        rows = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        die(f"stdin is not JSON: {e}")
    if not isinstance(rows, list):
        die("stdin must be a JSON array of chore rows")
    defs = chore_defs(rows)
    if isinstance(defs, str):
        die(f"{defs}. Nothing was sent.", 2)
    call("PUT", "/api/eva/chores", {"chores": defs})
    out({"ok": True, "count": len(defs)})


def cmd_balances(_args) -> None:
    resp = call("GET", "/api/eva/balances")
    result = {}
    for who, b in (resp.get("balances") or {}).items():
        last = b.get("lastPaidAt")
        result[who] = {
            "owed": b["owed"], "earned": b["earned"], "paid": b["paid"],
            "lastPaid": tokyo_iso(last)[:10] if last else None,
        }
    out(result)
    line = "; ".join(f"{display_name(w)} owed ¥{b['owed']}" for w, b in result.items())
    print(line or "no balances yet", file=sys.stderr)


def cmd_pay(args) -> None:
    if args.who not in PEOPLE:
        die(f"unknown person {args.who!r}; expected one of {', '.join(PEOPLE)}")
    if args.amount == 0:
        die("amount must be a non-zero integer (negative = credit)")
    pid = args.id or f"ev-{secrets.token_hex(6)}"
    if not ID.match(pid):
        die(f"id must match {ID.pattern}")
    body = {"who": args.who, "amount": args.amount, "id": pid}
    if args.note:
        body["note"] = args.note
    r = call("POST", "/api/eva/payments", body)
    out({"ok": True, "id": r.get("id", pid), "duplicate": bool(r.get("duplicate"))})


def cmd_new_chore_id(args) -> None:
    print(new_chore_id(args.name, set(args.taken)))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("activity")
    a.add_argument("--log-id")
    a.add_argument("--after", type=int)
    a.set_defaults(fn=cmd_activity)
    sp.add_parser("push-chores").set_defaults(fn=cmd_push_chores)
    sp.add_parser("balances").set_defaults(fn=cmd_balances)
    p = sp.add_parser("pay")
    p.add_argument("who")
    p.add_argument("amount", type=int)
    p.add_argument("--note")
    p.add_argument("--id")
    p.set_defaults(fn=cmd_pay)
    n = sp.add_parser("new-chore-id")
    n.add_argument("name")
    n.add_argument("--taken", nargs="*", default=[])
    n.set_defaults(fn=cmd_new_chore_id)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
