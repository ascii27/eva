# /// script
# requires-python = ">=3.10"
# dependencies = ["pyicloud>=2026.11.2"]
# ///
"""The family's chores, from Apple Reminders to the board and back.

Runs next to the board on the VM (deploy/wallboard-reminders.service). Every few
seconds it looks at the board (localhost, cheap); every ICLOUD_POLL seconds, or
at once when a chore was tapped on the board, it reads the #Chore reminders
from the Family list, writes the board's taps back to them, and pushes the list
to PUT /api/eva/chores. The policy — what's due, what counts as done — is in
chores.py; this file is only I/O.

Login: a pyicloud session copied from a Mac (`scripts/probe-reminders.py` logs
in there with password + 2FA; then copy ~/.wallboard-icloud to the VM). No
password ever lives on the VM. When Apple expires the session this stops
touching iCloud, keeps the board's last list, and publishes the `chores-sync`
panel as {ok: false, reason: "login"}; log in again and copy the session.

Env (from /etc/wallboard.env): HERMES_TOKEN, PORT; optional ICLOUD_ID (else
the one saved session's name is used), ICLOUD_SESSION_DIR, REMINDERS_LIST, REMINDERS_TAG, SYNC_STATE, ICLOUD_POLL,
BOARD_POLL, WALLBOARD_URL. Never logs the Apple ID or reminder contents.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chores import TOKYO, Item, Memory, plan  # noqa: E402

ENV = os.environ
BOARD = ENV.get("WALLBOARD_URL", f"http://localhost:{ENV.get('PORT', '8080')}")
TOKEN = ENV.get("HERMES_TOKEN", "")
SESSION_DIR = Path(ENV.get("ICLOUD_SESSION_DIR", str(Path.home() / ".wallboard-icloud")))
LIST_NAME = ENV.get("REMINDERS_LIST", "Family")
TAG = ENV.get("REMINDERS_TAG", "Chore").lstrip("#").lower()
STATE_FILE = Path(ENV.get("SYNC_STATE", str(Path(__file__).resolve().parent.parent / "data" / "reminders-sync.json")))
ICLOUD_POLL = int(ENV.get("ICLOUD_POLL", "120"))
BOARD_POLL = int(ENV.get("BOARD_POLL", "5"))
LOGIN_BACKOFF = 600


def log(msg: str) -> None:
    print(f"[reminders] {msg}", flush=True)


class LoginNeeded(Exception):
    pass


def account_name() -> str | None:
    """ICLOUD_ID, or else the name of the one saved session. pyicloud names its
    files after the Apple ID with punctuation stripped and only uses the name to
    find them while the session is valid, so the address itself never has to
    sit in the VM's env file."""
    if ENV.get("ICLOUD_ID"):
        return ENV["ICLOUD_ID"]
    found = sorted(SESSION_DIR.glob("*.session"))
    return found[0].stem if len(found) == 1 else None


# ---- board -------------------------------------------------------------------

def board_call(method: str, path: str, body=None):
    req = urllib.request.Request(
        BOARD + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def board_state() -> dict:
    status, s = board_call("GET", "/api/eva/state")
    if status != 200 or not isinstance(s, dict):
        raise RuntimeError(f"board state: HTTP {status}")
    return s


def mine(state: dict) -> dict:
    """The sync's chores on the board, {id: done}."""
    return {c["id"]: bool(c.get("done")) for c in state.get("chores", []) if str(c.get("id", "")).startswith("r-")}


def same_list(state: dict, chores: list[dict]) -> bool:
    keys = ("id", "title", "who", "icon", "done")
    have = [{k: c.get(k) for k in keys} for c in state.get("chores", [])]
    return have == [{k: c.get(k) for k in keys} for c in chores]


_status = None


def publish_status(ok: bool, reason: str | None = None) -> None:
    """The `chores-sync` panel, only when it changes (every push re-renders the board)."""
    global _status
    if _status == (ok, reason):
        return
    data = {"ok": ok, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if reason:
        data["reason"] = reason
    status, _ = board_call("PUT", "/api/eva/panels/chores-sync", {"data": data})
    if status == 200:
        _status = (ok, reason)


# ---- memory --------------------------------------------------------------------

def load_memory() -> Memory:
    try:
        return Memory.from_json(json.loads(STATE_FILE.read_text()))
    except (OSError, ValueError):
        return Memory()


def save_memory(mem: Memory) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(mem.to_json()))
    tmp.replace(STATE_FILE)


# ---- iCloud --------------------------------------------------------------------

class Reminders:
    def __init__(self) -> None:
        self.api = None
        self.target = None
        self.records: dict = {}

    def connect(self) -> None:
        from pyicloud import PyiCloudService
        from pyicloud.exceptions import PyiCloudFailedLoginException, PyiCloud2FARequiredException, PyiCloudAuthRequiredException
        apple_id = account_name()
        if not apple_id:
            raise LoginNeeded("no saved session")
        try:
            api = PyiCloudService(apple_id, cookie_directory=str(SESSION_DIR))
        except (PyiCloudFailedLoginException, PyiCloud2FARequiredException, PyiCloudAuthRequiredException) as e:
            raise LoginNeeded(type(e).__name__) from None
        if api.requires_2fa or api.requires_2sa:
            raise LoginNeeded("session needs 2FA")
        self.api, self.target = api, None

    def _retrying(self, fn):
        # A first query against a list can make CloudKit build its indexes.
        for attempt in range(4):
            try:
                return fn()
            except Exception as e:
                if "TRY_AGAIN_LATER" not in str(e) or attempt == 3:
                    raise
                time.sleep(40)

    def fetch(self) -> list[Item]:
        if self.api is None:
            self.connect()
        svc = self.api.reminders
        if self.target is None:
            self.target = next((l for l in svc.lists() if l.title.strip().lower() == LIST_NAME.lower()), None)
            if self.target is None:
                raise RuntimeError("no Reminders list with the configured name")
        snap = self._retrying(lambda: svc.list_reminders(self.target, include_completed=True, results_limit=500))
        tagged = {h.reminder_id for h in snap.hashtags.values() if h.name.strip().lstrip("#").lower() == TAG}
        rules = {r.reminder_id: r for r in snap.recurrence_rules.values()}
        items, self.records = [], {}
        for r in snap.reminders:
            if r.deleted or r.id not in tagged:
                continue
            rule = rules.get(r.id)
            self.records[r.id] = r
            items.append(Item(
                rid=r.id, title=r.title, due=r.due_date, all_day=r.all_day,
                freq=rule.frequency.name.lower() if rule else None,
                interval=rule.interval if rule else 1,
                completed=r.completed,
                completed_on=r.completed_date.astimezone(TOKYO).date() if r.completed_date else None,
            ))
        return items

    def write(self, w) -> None:
        r = self.records[w.item.rid]
        if w.due is not None:
            r.due_date = w.due
        if w.completed is not None:
            r.completed = w.completed
            r.completed_date = None
        self.api.reminders.update(r)


# ---- the loop --------------------------------------------------------------------

def cycle(rem: Reminders, mem: Memory) -> tuple[Memory, bool]:
    """One full sync. Returns the memory to keep and whether to retry soon."""
    today = datetime.now(TOKYO).date()
    before = board_state()
    items = rem.fetch()
    writes, chores, nxt = plan(items, mine(before), mem, today)
    written = set()
    for w in writes:
        rem.write(w)
        written.add(w.item.id)
        log(f"{'ticked' if (w.completed or (w.due and w.item.due and w.due > w.item.due)) else 'unticked'} {w.item.id}")

    after = board_state()
    if mine(after) != mine(before):
        # A tap landed while we were talking to iCloud: push nothing now, so
        # it can't be overwritten; the next cycle picks it up.
        return _settled(mem, nxt, written, mine(before)), True
    if not same_list(after, chores):
        status, _ = board_call("PUT", "/api/eva/chores", {"chores": chores, "ifVersion": after["version"]})
        if status == 409:
            return _settled(mem, nxt, written, mine(before)), True
        if status != 200:
            raise RuntimeError(f"push chores: HTTP {status}")
    return nxt, False


def _settled(old: Memory, nxt: Memory, written: set, board: dict) -> Memory:
    """Nothing was pushed: keep what the board really has as 'pushed', except
    that taps already written to Reminders count as handled."""
    pushed = dict(old.pushed)
    for cid in written:
        pushed[cid] = board[cid]
    return Memory(pushed=pushed, seen=nxt.seen, ticks=nxt.ticks)


def main() -> None:
    if not TOKEN:
        sys.exit("HERMES_TOKEN is not set")
    rem, mem = Reminders(), load_memory()
    last_icloud, wait_until = 0.0, 0.0
    log(f"starting: board {BOARD}, list {LIST_NAME!r}, tag #{TAG}, every {ICLOUD_POLL}s")
    while True:
        now = time.monotonic()
        try:
            tapped = any(cid in mem.pushed and mem.pushed[cid] != done for cid, done in mine(board_state()).items())
            if now >= wait_until and (tapped or now - last_icloud >= ICLOUD_POLL):
                mem, again = cycle(rem, mem)
                save_memory(mem)
                last_icloud = 0.0 if again else time.monotonic()
                publish_status(True)
        except LoginNeeded as e:
            log(f"login needed ({e}); copy a fresh session from the Mac")
            rem.api = None
            publish_status(False, "login")
            wait_until = time.monotonic() + LOGIN_BACKOFF
        except Exception as e:                       # network, iCloud hiccups: try again later
            log(f"cycle failed: {type(e).__name__}: {str(e)[:200]}")
            rem.api = None if "auth" in str(e).lower() or "401" in str(e) else rem.api
            last_icloud = time.monotonic()
        time.sleep(BOARD_POLL)


if __name__ == "__main__":
    main()
