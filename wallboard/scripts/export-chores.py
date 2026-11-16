# /// script
# requires-python = ">=3.10"
# dependencies = ["pyicloud>=2026.11.2"]
# ///
"""One-off migration helper: the family's #Chore reminders, as Notion rows.

Read-only. Logs in to iCloud (saved session from probe-reminders.py, else
password + 2FA, prompted, never stored), reads the #Chore reminders from the
Reminders list, and prints a JSON array on stdout, one row per chore, using the
property names of the Notion "Chores" database. Hermes enters those rows.
Anything that can't be exported is listed on stderr as "needs a decision".

    uv run wallboard/scripts/export-chores.py > chores.json
    REMINDERS_LIST=Home REMINDERS_TAG=Errand uv run wallboard/scripts/export-chores.py

Self-contained on purpose: wallboard/sync/ is deleted once chores live in
Notion, so the bits it needs are copied here rather than imported. Never
writes to Reminders and never prints the Apple ID.
"""

from __future__ import annotations

import getpass
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

SESSION_DIR = Path.home() / ".wallboard-icloud"
LIST_NAME = os.environ.get("REMINDERS_LIST", "Family")
TAG = os.environ.get("REMINDERS_TAG", "Chore").lstrip("#").lower()
AMOUNT = 100

TOKYO = timezone(timedelta(hours=9))

# Copied from sync/chores.py. Only the girls are exported, but parse_title
# needs the full list to recognise the other names.
NAMES = [
    (("まりこ", "マリコ", "mariko"), "mariko"),
    (("さりな", "サリナ", "sarina"), "sarina"),
    (("のぞみ", "ノゾミ", "nozomi"), "nozomi"),
    (("マイケル", "michael"), "michael"),
]
GIRLS = {"mariko": "Mariko", "sarina": "Sarina"}

ICONS = [
    (("dish", "皿", "食器"), "dishes"),
    (("clear table", "clear the table", "片付け"), "clear-table"),
    (("bath", "tub", "お風呂", "風呂"), "tub-clean"),
    (("toilet", "トイレ"), "toilet"),
    (("vacuum", "掃除機"), "vacuum"),
    (("dust", "ほこり"), "dust"),
    (("garbage", "trash", "rubbish", "ゴミ", "ごみ"), "garbage"),
    (("window", "窓"), "windows"),
    (("living", "リビング"), "living-room"),
    (("table", "テーブル"), "table"),
    (("bed", "ベッド"), "bed"),
    (("bag", "かばん", "ランドセル"), "bag"),
    (("shoe", "靴"), "shoes"),
    (("laundry", "washing", "洗濯"), "laundry"),
    (("plant", "water the", "水やり"), "plants"),
]


@dataclass
class Item:
    """One #Chore reminder, as much of it as the export needs."""
    rid: str
    title: str
    due: Optional[datetime]       # tz-aware; all-day dates are 00:00 UTC "floating"
    all_day: bool = True
    freq: Optional[str] = None    # daily | weekly | monthly | yearly; None = doesn't repeat
    interval: int = 1
    completed: bool = False


def parse_title(title: str) -> tuple[str, Optional[str]]:
    """'Dishes - Mariko' -> ('Dishes', 'mariko'). No (known) name -> (title, None)."""
    head, sep, tail = title.rpartition(" - ")
    if not sep:
        return title.strip(), None
    who = next((pid for words, pid in NAMES if any(w in tail.lower() for w in words)), None)
    return (head.strip(), who) if who else (title.strip(), None)


def guess_icon(name: str) -> Optional[str]:
    n = name.lower()
    return next((key for words, key in ICONS if any(w in n for w in words)), None)


def due_day(it: Item) -> Optional[date]:
    """The calendar day it's due. All-day dates are floating (stored at 00:00
    UTC), so their UTC date is the day; a timed due date is a Tokyo day."""
    if it.due is None:
        return None
    return it.due.date() if it.all_day else it.due.astimezone(TOKYO).date()


def new_chore_id(name: str, taken: set) -> str:
    """Copied from hermes/skills/eva-chores/scripts/eva_chores.py."""
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


def build_rows(items: list[Item]) -> tuple[list[dict], list[str]]:
    """Pure: Items -> (Notion rows, 'needs a decision' lines). No I/O."""
    rows: list[dict] = []
    skipped: list[str] = []
    taken: set = set()

    def skip(it: Item, reason: str) -> None:
        skipped.append(f"needs a decision: {it.title} — {reason}")

    for it in sorted(items, key=lambda i: (i.title.lower(), i.rid)):
        name, who = parse_title(it.title)
        if it.freq is None:
            skip(it, "completed and doesn't repeat" if it.completed else "doesn't repeat")
        elif it.freq not in ("daily", "weekly"):
            skip(it, f"repeats {it.freq}")
        elif it.due is None:
            skip(it, "no due date")
        elif who not in GIRLS:
            skip(it, "not assigned to Mariko or Sarina")
        else:
            cid = new_chore_id(name, taken)
            taken.add(cid)
            rows.append({
                "Board id": cid,
                "Name": name,
                "Who": GIRLS[who],
                "Icon": guess_icon(name) or "",
                "Amount ¥": AMOUNT,
                "Every": max(1, it.interval),
                "Unit": "day" if it.freq == "daily" else "week",
                "Start": due_day(it).isoformat(),
                "Active": True,
            })
    return rows, skipped


# ---- iCloud (read-only) --------------------------------------------------------

def login():
    from pyicloud import PyiCloudService  # only here, so the pure part needs no deps

    SESSION_DIR.mkdir(mode=0o700, exist_ok=True)
    found = sorted(SESSION_DIR.glob("*.session"))
    apple_id = os.environ.get("ICLOUD_ID") or (found[0].stem if len(found) == 1 else None) or input("Apple ID: ").strip()
    try:
        api = PyiCloudService(apple_id, cookie_directory=str(SESSION_DIR))
    except Exception:
        api = PyiCloudService(
            apple_id, getpass.getpass("Password: "), cookie_directory=str(SESSION_DIR)
        )
    if api.requires_2fa:
        code = input("2FA code from a trusted device: ").strip()
        if not api.validate_2fa_code(code):
            sys.exit("2FA code rejected")
        if not api.is_trusted_session:
            api.trust_session()
    elif api.requires_2sa:
        sys.exit("This account uses legacy two-step verification; not supported here")
    return api


def fetch(api) -> list[Item]:
    svc = api.reminders
    target = next((l for l in svc.lists() if l.title.strip().lower() == LIST_NAME.lower()), None)
    if target is None:
        sys.exit(f"No Reminders list named {LIST_NAME!r}. Shared lists need pyicloud >= 2026.11.2.")
    # The first query against a list can make CloudKit build its indexes.
    for attempt in range(6):
        try:
            snap = svc.list_reminders(target, include_completed=True, results_limit=500)
            break
        except Exception as e:
            if "TRY_AGAIN_LATER" not in str(e) or attempt == 5:
                raise
            print(f"CloudKit is indexing; retrying in 40s ({attempt + 1}/5)", file=sys.stderr, flush=True)
            time.sleep(40)
    tagged = {h.reminder_id for h in snap.hashtags.values() if h.name.strip().lstrip("#").lower() == TAG}
    rules = {r.reminder_id: r for r in snap.recurrence_rules.values()}
    items = []
    for r in snap.reminders:
        if r.deleted or r.id not in tagged:
            continue
        rule = rules.get(r.id)
        items.append(Item(
            rid=r.id, title=r.title, due=r.due_date, all_day=r.all_day,
            freq=rule.frequency.name.lower() if rule else None,
            interval=rule.interval if rule else 1,
            completed=r.completed,
        ))
    return items


def main() -> None:
    import json

    rows, skipped = build_rows(fetch(login()))
    for line in skipped:
        print(line, file=sys.stderr)
    print(f"{len(rows)} exported, {len(skipped)} need a decision", file=sys.stderr)
    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
