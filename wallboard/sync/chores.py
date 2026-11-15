"""The chore policy for the Reminders sync. Pure: no network, no clock — the
caller passes `today` — so it is unit-tested (test_chores.py) and the I/O shell
in reminders_sync.py stays thin. The same split as server/state.ts.

What the family sees, decided 2026-11-15 from the real "Family" list:
  - Chores are reminders tagged #Chore, titled "Chore - Name" ("Dishes - Mariko").
  - They repeat (daily, every 2 days, weekly), all-day. Ticking a repeating
    reminder on an iPhone does NOT set a completed flag and iCloud keeps no
    completed copy: the app moves the same reminder's due date to the next
    occurrence. So "done today" is something we infer, and a tick from the
    board does what the phone does (verified on the phone: moved, not gone).

Visibility, per chore:
  - due today or earlier → shown, to do
  - was seen due today, and its due date has since moved on (a tick on the
    phone or the board) → shown, done, until midnight
  - otherwise (due later, never seen today) → hidden
"Seen due today" is remembered by the caller across restarts. A due date can
also move because someone edited the reminder — that is why it is not inferred
from `modified`: Michael renamed every chore on the day this was built, which
would have read as all of them done.

Who wins when both sides changed: the caller remembers what it last pushed. A
board chore whose done differs from that was tapped on the board, so it is
written to Reminders; anything else follows Reminders.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from typing import Optional

TOKYO = timezone(timedelta(hours=9))

# Who, from the name after the last " - ". Same people and spellings as the
# calendar's whoOf() in server/calendar.ts.
NAMES = [
    (("まりこ", "マリコ", "mariko"), "mariko"),
    (("さりな", "サリナ", "sarina"), "sarina"),
    (("のぞみ", "ノゾミ", "nozomi"), "nozomi"),
    (("マイケル", "michael"), "michael"),
]

# Icon from the chore's name: keys in web/icons.js (CLAUDE.md "Chore icons").
# First match wins, so the specific ones come before the words they contain
# ("clear the table" before "table"). Cleaning the bath is `tub-clean`: `bath`
# on the board means bath order. No match → null, the board's generic icon.
ICONS = [
    (("dish", "皿", "食器"), "dishes"),
    (("clear table", "clear the table", "片付け"), "clear-table"),
    (("bath", "tub", "お風呂", "風呂"), "tub-clean"),
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
    """One #Chore reminder, as much of it as the policy needs."""
    rid: str                      # the reminder's record id ("Reminder/…")
    title: str
    due: Optional[datetime]       # tz-aware; all-day dates are 00:00 UTC "floating"
    all_day: bool = True
    freq: Optional[str] = None    # daily | weekly | monthly | yearly; None = doesn't repeat
    interval: int = 1
    completed: bool = False
    completed_on: Optional[date] = None   # Tokyo date

    @property
    def id(self) -> str:
        """The board's chore id: short, and valid for its ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$."""
        return "r-" + self.rid.split("/")[-1].lower()


@dataclass
class Memory:
    """What the sync remembers between cycles (and restarts)."""
    pushed: dict = field(default_factory=dict)   # board id -> done, as last pushed
    seen: dict = field(default_factory=dict)     # board id -> ISO day it was seen due
    ticks: dict = field(default_factory=dict)    # board id -> {"day": ISO, "from": ISO due} for undo

    def to_json(self) -> dict:
        return {"pushed": self.pushed, "seen": self.seen, "ticks": self.ticks}

    @classmethod
    def from_json(cls, raw) -> "Memory":
        if not isinstance(raw, dict):
            return cls()
        pick = lambda k: raw.get(k) if isinstance(raw.get(k), dict) else {}
        return cls(pushed=pick("pushed"), seen=pick("seen"), ticks=pick("ticks"))


@dataclass
class Write:
    """A change to make in Reminders: a new due date, or (non-repeating) completed."""
    item: Item
    due: Optional[datetime] = None
    completed: Optional[bool] = None


def parse_title(title: str) -> tuple[str, Optional[str]]:
    """'Dishes - Mariko' → ('Dishes', 'mariko'). No (known) name → (title, None)."""
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


def _add_months(d: datetime, months: int) -> datetime:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def step(due: datetime, freq: str, interval: int, sign: int = 1) -> datetime:
    """One occurrence forward (sign=1) or back (sign=-1)."""
    n = interval * sign
    if freq == "daily":
        return due + timedelta(days=n)
    if freq == "weekly":
        return due + timedelta(weeks=n)
    if freq == "monthly":
        return _add_months(due, n)
    return _add_months(due, 12 * n)   # yearly


def _with_due(it: Item, due: datetime) -> Item:
    return replace(it, due=due)


def plan(items: list[Item], board: dict, mem: Memory, today: date) -> tuple[list[Write], list[dict], Memory]:
    """
    One sync cycle. `board` is {board id: done} for the sync's chores as the
    board has them now. Returns the writes to make in Reminders, the chore list
    to push to the board, and the memory to keep.
    """
    t = today.isoformat()
    mem = Memory(
        pushed=dict(mem.pushed),
        seen={k: v for k, v in mem.seen.items() if v == t},          # yesterday's sightings expire
        ticks={k: v for k, v in mem.ticks.items() if v.get("day") == t},
    )
    by_id = {it.id: it for it in items}

    def state(it: Item) -> Optional[bool]:
        """None = hidden; False = to do; True = done today."""
        if it.freq is None:
            if it.completed:
                return True if it.completed_on == today else None
            day = due_day(it)
            return False if day is None or day <= today else None
        day = due_day(it)
        if day is not None and day <= today:
            return False
        if mem.seen.get(it.id) == t or it.id in mem.ticks:
            return True
        return None

    for it in items:
        if state(it) is False:
            mem.seen[it.id] = t

    # Taps on the board since the last push become writes to Reminders.
    writes: list[Write] = []
    for cid, done in board.items():
        it = by_id.get(cid)
        if it is None or cid not in mem.pushed or mem.pushed[cid] == done or state(it) is None:
            continue
        if state(it) == done:
            continue                                  # the phone already agrees
        if it.freq is None:
            writes.append(Write(it, completed=done))
            by_id[cid] = replace(it, completed=done, completed_on=today if done else None)
            continue
        if it.due is None:
            continue                                  # a repeat with no date: nothing to move
        if done:
            new = it.due
            while due_day(_with_due(it, new)) <= today:
                new = step(new, it.freq, it.interval)
            mem.ticks[cid] = {"day": t, "from": it.due.isoformat()}
        else:
            tick = mem.ticks.pop(cid, None)
            new = datetime.fromisoformat(tick["from"]) if tick else step(it.due, it.freq, it.interval, -1)
            if due_day(_with_due(it, new)) > today:   # never undo into the future
                new = it.due
        writes.append(Write(it, due=new))
        by_id[cid] = _with_due(it, new)
        mem.seen[cid] = t

    chores = []
    for it in by_id.values():
        s = state(it)
        if s is None:
            continue
        name, who = parse_title(it.title)
        chores.append({"id": it.id, "title": name, "who": who, "icon": guess_icon(name), "done": s})
    order = {"mariko": 0, "sarina": 1}
    chores.sort(key=lambda c: (order.get(c["who"], 2), c["title"].lower()))
    mem.pushed = {c["id"]: c["done"] for c in chores}
    return writes, chores, mem
