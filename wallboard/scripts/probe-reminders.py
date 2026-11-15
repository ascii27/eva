# /// script
# requires-python = ">=3.10"
# dependencies = ["pyicloud>=2026.11.2"]
# ///
"""Probe: can pyicloud read the family's #Chores out of the shared Reminders list?

Read-only. Logs in to iCloud (password + 2FA, prompted, never stored), then
prints what the board would need to know about each #Chore reminder: title,
due date, whether it repeats, completed, and every tag on it. That output is
what decides how `who`, the icon and the daily done state get mapped.

    uv run wallboard/scripts/probe-reminders.py            # list "Family", tag #Chore
    REMINDERS_LIST=Home REMINDERS_TAG=Errand uv run wallboard/scripts/probe-reminders.py

The session (trust cookies, not the password) is kept in ~/.wallboard-icloud so
a second run skips 2FA. Delete that directory to log out.

Shared lists come back from the "shared" CloudKit database, which pyicloud only
discovers from 2026.11.2 on. Advanced Data Protection blocks all of this unless
"Access iCloud Data on the Web" is on for the account.
"""

import getpass
import os
import sys
import time
from pathlib import Path

from pyicloud import PyiCloudService

SESSION_DIR = Path.home() / ".wallboard-icloud"
LIST_NAME = os.environ.get("REMINDERS_LIST", "Family")
TAG = os.environ.get("REMINDERS_TAG", "Chore").lstrip("#").lower()


def login() -> PyiCloudService:
    SESSION_DIR.mkdir(mode=0o700, exist_ok=True)
    # A saved session is found by its file name (the Apple ID minus punctuation),
    # so a re-run needs no Apple ID typed or in the environment.
    found = sorted(SESSION_DIR.glob("*.session"))
    apple_id = os.environ.get("ICLOUD_ID") or (found[0].stem if len(found) == 1 else None) or input("Apple ID: ").strip()
    # Try the saved session first; only ask for the password if it's gone stale.
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


def main() -> None:
    api = login()
    svc = api.reminders

    lists = list(svc.lists())
    print(f"\n{len(lists)} lists:")
    for l in lists:
        print(f"  {l.title!r:30} scope={l.scope} count={l.count}")

    matches = [l for l in lists if l.title.strip().lower() == LIST_NAME.lower()]
    if not matches:
        sys.exit(f"\nNo list named {LIST_NAME!r}. Shared lists need pyicloud >= 2026.11.2.")
    target = matches[0]

    # The first query against a list can make CloudKit build its indexes:
    # 400 TRY_AGAIN_LATER with a retryAfter. Wait it out rather than fail.
    for attempt in range(6):
        try:
            snap = svc.list_reminders(target, include_completed=True, results_limit=500)
            break
        except Exception as e:
            if "TRY_AGAIN_LATER" not in str(e) or attempt == 5:
                raise
            print(f"  CloudKit is indexing; retrying in 40s ({attempt + 1}/5)", flush=True)
            time.sleep(40)
    tags_by_reminder: dict[str, list[str]] = {}
    for h in snap.hashtags.values():
        tags_by_reminder.setdefault(h.reminder_id, []).append(h.name)
    rules = {r.reminder_id: r for r in snap.recurrence_rules.values()}

    all_tags = sorted({t for ts in tags_by_reminder.values() for t in ts}, key=str.lower)
    print(f"\n{target.title!r}: {len(snap.reminders)} reminders; tags in use: {all_tags}")

    chores = [
        r for r in snap.reminders
        if not r.deleted and TAG in (t.lower() for t in tags_by_reminder.get(r.id, []))
    ]
    print(f"\n{len(chores)} tagged #{TAG}:")
    for r in sorted(chores, key=lambda r: (r.completed, r.title.lower())):
        rule = rules.get(r.id)
        repeat = f"{rule.frequency.name.lower()}/{rule.interval}" if rule else "-"
        print(
            f"  [{'x' if r.completed else ' '}] {r.title!r}\n"
            f"      id={r.id}  due={r.due_date}  all_day={r.all_day}  repeat={repeat}\n"
            f"      completed_at={r.completed_date}  parent={r.parent_reminder_id}\n"
            f"      tags={tags_by_reminder.get(r.id, [])}  notes={r.desc[:60]!r}"
        )


if __name__ == "__main__":
    main()
