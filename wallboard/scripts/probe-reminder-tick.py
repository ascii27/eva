# /// script
# requires-python = ">=3.10"
# dependencies = ["pyicloud>=2026.11.2"]
# ///
"""Probe: can the board tick a repeating chore the way the iPhone does?

Ticking a repeating reminder in the Reminders app does not set a completed
flag: it moves the same reminder's due date to the next occurrence (iCloud keeps
no completed copy — probe-reminders.py found none). This does exactly that to
ONE throwaway reminder, then reads it back, so a person can check on a phone
that it moved rather than vanished.

Safety: it refuses any reminder whose title doesn't start with "Test".

    uv run wallboard/scripts/probe-reminder-tick.py           # advance one step
    uv run wallboard/scripts/probe-reminder-tick.py --undo    # move it back one step

Needs the saved session from probe-reminders.py (~/.wallboard-icloud).
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

from pyicloud import PyiCloudService
from pyicloud.services.reminders.models.domain import RecurrenceFrequency

SESSION_DIR = Path.home() / ".wallboard-icloud"
LIST_NAME = os.environ.get("REMINDERS_LIST", "Family")
TITLE = os.environ.get("TICK_TITLE", "Test - Mariko")


def step(due, rule, sign: int):
    """The next (or previous) occurrence. Monthly/yearly aren't needed for chores."""
    n = rule.interval * sign
    if rule.frequency == RecurrenceFrequency.DAILY:
        return due + timedelta(days=n)
    if rule.frequency == RecurrenceFrequency.WEEKLY:
        return due + timedelta(weeks=n)
    sys.exit(f"probe only handles daily/weekly, got {rule.frequency.name}")


def main() -> None:
    if not TITLE.lower().startswith("test"):
        sys.exit("refusing: only reminders titled 'Test…' may be touched")
    undo = "--undo" in sys.argv
    found = sorted(SESSION_DIR.glob("*.session"))
    name = os.environ.get("ICLOUD_ID") or (found[0].stem if len(found) == 1 else None)
    if not name:
        sys.exit("no saved session: run probe-reminders.py in a terminal to log in")
    api = PyiCloudService(name, cookie_directory=str(SESSION_DIR))
    if api.requires_2fa:
        sys.exit("session expired: run probe-reminders.py in a terminal to log in")
    svc = api.reminders

    target = next(l for l in svc.lists() if l.title.strip().lower() == LIST_NAME.lower())
    snap = svc.list_reminders(target, include_completed=True, results_limit=500)
    hits = [r for r in snap.reminders if not r.deleted and r.title.strip() == TITLE]
    if len(hits) != 1:
        sys.exit(f"expected exactly one {TITLE!r}, found {len(hits)}")
    r = hits[0]
    rule = next((x for x in snap.recurrence_rules.values() if x.reminder_id == r.id), None)
    if rule is None or r.due_date is None:
        sys.exit(f"{TITLE!r} needs a due date and a repeat rule")

    before = r.due_date
    r.due_date = step(before, rule, -1 if undo else 1)
    print(f"{TITLE!r}: due {before} -> {r.due_date}  (all_day={r.all_day}, tz={r.time_zone}, completed={r.completed})")
    svc.update(r)

    after = svc.list_reminders(target, include_completed=True, results_limit=500)
    again = next(x for x in after.reminders if x.id == r.id)
    print(f"read back: due={again.due_date} completed={again.completed} title={again.title!r} "
          f"notes={again.desc!r} repeat_kept={any(x.reminder_id == r.id for x in after.recurrence_rules.values())}")


if __name__ == "__main__":
    main()
