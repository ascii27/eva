import contextlib
import io
import json
import unittest
from unittest import mock

import eva_events as ee

PLAN = {
    "id": "tc-401506", "title": "Roof Park Art Fes on the KK Line", "url": "https://tokyocheapo.com/events/roof-park-art-fes-kk-line/",
    "day": "2026-11-28", "time": "17:00", "until": "20:30", "venue": "KK Line (Tokyo Sky Corridor)", "place": "Ginza, Central Tokyo",
    "want": "add", "status": "pending", "requestedAt": 1, "updatedAt": 1,
}


class Entry(unittest.TestCase):
    def test_timed(self):
        e = ee.calendar_entry(PLAN)
        self.assertEqual(e["start"], "2026-11-28T17:00:00+09:00")
        self.assertEqual(e["end"], "2026-11-28T20:30:00+09:00")
        self.assertFalse(e["allDay"])
        self.assertEqual(e["location"], "KK Line (Tokyo Sky Corridor), Ginza, Central Tokyo")
        self.assertTrue(e["notes"].startswith("https://tokyocheapo.com/events/roof-park-art-fes-kk-line/\n"))

    def test_all_day_and_defaults(self):
        e = ee.calendar_entry({**PLAN, "time": None, "until": None, "venue": None, "place": None})
        self.assertEqual((e["allDay"], e["date"]), (True, "2026-11-28"))
        self.assertNotIn("location", e)
        e = ee.calendar_entry({**PLAN, "until": None})
        self.assertEqual(e["end"], "2026-11-28T19:00:00+09:00")

    def test_opening_hours_go_all_day(self):
        e = ee.calendar_entry({**PLAN, "time": "10:00", "until": "22:00"})
        self.assertEqual((e["allDay"], e["date"]), (True, "2026-11-28"))
        self.assertNotIn("start", e)
        self.assertTrue(e["notes"].startswith("Open 10:00–22:00\nhttps://"))

    def test_past_midnight(self):
        e = ee.calendar_entry({**PLAN, "time": "22:00", "until": "1:00"})
        self.assertEqual(e["end"], "2026-11-29T01:00:00+09:00")

    def test_view(self):
        v = ee.view({**PLAN, "ref": "cal-1", "note": "x"})
        self.assertEqual((v["weekday"], v["ref"], v["last_note"]), ("Saturday", "cal-1", "x"))


def run(argv, responses):
    """Run the CLI with `call` mocked; returns (exit code, stdout, stderr, calls)."""
    calls = []

    def fake(method, path, body=None):
        calls.append((method, path, body))
        r = responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    out, err = io.StringIO(), io.StringIO()
    code = 0
    with mock.patch.object(ee, "call", fake), mock.patch("sys.argv", ["eva_events.py", *argv]), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            ee.main()
        except SystemExit as e:
            code = e.code or 0
    return code, out.getvalue(), err.getvalue(), calls


class Cli(unittest.TestCase):
    def test_pending_only_lists_pending(self):
        code, out, _, _ = run(["pending"], [{"plans": [PLAN, {**PLAN, "id": "tc-2", "status": "done"}]}])
        self.assertEqual(code, 0)
        self.assertEqual([p["id"] for p in json.loads(out)], ["tc-401506"])

    def test_done_sends_ref(self):
        code, _, _, calls = run(["done", "tc-401506", "--want", "add", "--ref", "cal-9"], [{"ok": True}])
        self.assertEqual(code, 0)
        self.assertEqual(calls, [("PUT", "/api/eva/plans/tc-401506", {"want": "add", "result": "done", "ref": "cal-9"})])

    def test_failed_needs_a_short_note(self):
        code, _, err, calls = run(["failed", "tc-1", "--want", "add", "--note", "  "], [])
        self.assertEqual((code, calls), (2, []))
        code, _, err, calls = run(["failed", "tc-1", "--want", "add", "--note", "x" * 201], [])
        self.assertEqual((code, calls), (2, []))
        code, _, _, calls = run(["failed", "tc-1", "--want", "add", "--note", "can't  write\nthe calendar"], [{"ok": True}])
        self.assertEqual(calls[0][2], {"want": "add", "result": "failed", "note": "can't write the calendar"})

    def test_stale_exits_3(self):
        code, _, err, _ = run(["done", "tc-1", "--want", "add"], [ee.Stale("changed")])
        self.assertEqual(code, 3)
        self.assertIn("run `pending` again", err)


if __name__ == "__main__":
    unittest.main()
