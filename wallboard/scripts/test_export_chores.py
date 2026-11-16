"""python3 -m unittest wallboard/scripts/test_export_chores.py  (no deps, no iCloud)"""

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("export_chores", Path(__file__).with_name("export-chores.py"))
ec = importlib.util.module_from_spec(spec)
sys.modules["export_chores"] = ec
spec.loader.exec_module(ec)


def item(title, freq="daily", interval=1, day=(2026, 11, 16), completed=False, rid=None):
    due = datetime(*day, tzinfo=timezone.utc) if day else None
    return ec.Item(rid=rid or f"Reminder/{title}", title=title, due=due, freq=freq, interval=interval, completed=completed)


class BuildRows(unittest.TestCase):
    def test_daily(self):
        rows, skipped = ec.build_rows([item("Dishes - Mariko")])
        self.assertEqual(skipped, [])
        self.assertEqual(rows, [{
            "Board id": "chore-dishes", "Name": "Dishes", "Who": "Mariko", "Icon": "dishes",
            "Amount ¥": 100, "Every": 1, "Unit": "day", "Start": "2026-11-16", "Active": True,
        }])

    def test_every_two_days(self):
        rows, _ = ec.build_rows([item("Vacuum - Sarina", interval=2)])
        self.assertEqual((rows[0]["Every"], rows[0]["Unit"], rows[0]["Who"]), (2, "day", "Sarina"))

    def test_weekly_unknown_icon(self):
        rows, _ = ec.build_rows([item("Sort the shelf - Sarina", freq="weekly", day=(2026, 11, 20))])
        self.assertEqual((rows[0]["Every"], rows[0]["Unit"], rows[0]["Icon"], rows[0]["Start"]), (1, "week", "", "2026-11-20"))

    def test_monthly_skipped(self):
        rows, skipped = ec.build_rows([item("Windows - Mariko", freq="monthly")])
        self.assertEqual(rows, [])
        self.assertEqual(skipped, ["needs a decision: Windows - Mariko — repeats monthly"])

    def test_completed_one_off_skipped(self):
        rows, skipped = ec.build_rows([item("Bag - Mariko", freq=None, completed=True)])
        self.assertEqual(rows, [])
        self.assertIn("completed and doesn't repeat", skipped[0])

    def test_no_due_and_wrong_person_skipped(self):
        rows, skipped = ec.build_rows([item("Dishes - Mariko", day=None), item("Garbage - Michael"), item("Plants")])
        self.assertEqual(rows, [])
        self.assertEqual(len(skipped), 3)
        self.assertIn("no due date", skipped[0])

    def test_same_name_gets_suffix(self):
        rows, _ = ec.build_rows([item("Dishes - Mariko", rid="Reminder/a"), item("Dishes - Sarina", rid="Reminder/b")])
        self.assertEqual([r["Board id"] for r in rows], ["chore-dishes", "chore-dishes-2"])

    def test_non_ascii_name_falls_back_to_number(self):
        rows, _ = ec.build_rows([item("お皿 - まりこ")])
        self.assertEqual(rows[0]["Board id"], "chore-1")
        self.assertEqual(rows[0]["Icon"], "dishes")


if __name__ == "__main__":
    unittest.main()
