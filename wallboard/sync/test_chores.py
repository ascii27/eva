"""Tests for the chore policy. Stdlib only:  python3 -m unittest discover -s sync"""

import unittest
from datetime import date, datetime, timezone

from chores import Item, Memory, guess_icon, parse_title, plan

UTC = timezone.utc
TODAY = date(2026, 11, 15)


def day(d: int) -> datetime:
    """An all-day due date as iCloud stores it: 00:00 UTC, floating."""
    return datetime(2026, 11, d, tzinfo=UTC)


def item(n: str, title: str, due, freq="daily", interval=1, **kw) -> Item:
    return Item(rid=f"Reminder/{n.upper()}", title=title, due=due, freq=freq, interval=interval, **kw)


DISHES = item("aa", "Dishes - Mariko", day(15))
TABLE = item("bb", "Clear Table - Sarina", day(15))
BATH = item("cc", "Clean Bath - Sarina", day(16), interval=2)
VACUUM = item("dd", "Vacuum - Mariko", day(21), freq="weekly")
ALL = [DISHES, TABLE, BATH, VACUUM]


def shown(chores):
    return {c["title"]: c["done"] for c in chores}


class Titles(unittest.TestCase):
    def test_name_after_the_last_dash(self):
        self.assertEqual(parse_title("Dishes - Mariko"), ("Dishes", "mariko"))
        self.assertEqual(parse_title("Clean Bath - さりな"), ("Clean Bath", "sarina"))
        self.assertEqual(parse_title("Pick up - drop off - Sarina"), ("Pick up - drop off", "sarina"))
        self.assertEqual(parse_title("Dishes"), ("Dishes", None))
        self.assertEqual(parse_title("Dishes - Grandma"), ("Dishes - Grandma", None))   # unknown: keep it whole

    def test_icons_only_when_the_board_has_one(self):
        self.assertEqual(guess_icon("Clear Table"), "clear-table")
        self.assertEqual(guess_icon("Set the table"), "table")
        self.assertEqual(guess_icon("Clean Bath"), "tub-clean")    # `bath` is bath order
        self.assertEqual(guess_icon("Clean Toilet"), "toilet")
        self.assertEqual(guess_icon("Vacuum"), "vacuum")
        self.assertEqual(guess_icon("Dishes"), "dishes")
        self.assertEqual(guess_icon("Take out the trash"), "garbage")
        self.assertIsNone(guess_icon("Feed the cat"))


class Visibility(unittest.TestCase):
    def test_due_today_or_overdue_shows_to_do_later_hides(self):
        overdue = item("ee", "Plants - Mariko", day(13))
        _, chores, mem = plan(ALL + [overdue], {}, Memory(), TODAY)
        self.assertEqual(shown(chores), {"Dishes": False, "Plants": False, "Clear Table": False})
        self.assertEqual(set(mem.seen), {DISHES.id, TABLE.id, overdue.id})

    def test_a_tick_on_the_phone_shows_done_until_midnight(self):
        _, _, mem = plan(ALL, {}, Memory(), TODAY)
        moved = item("aa", "Dishes - Mariko", day(16))               # the phone advanced it
        _, chores, mem = plan([moved, TABLE, BATH, VACUUM], {}, mem, TODAY)
        self.assertEqual(shown(chores)["Dishes"], True)
        _, chores, _ = plan([moved, TABLE, BATH, VACUUM], {}, mem, date(2026, 11, 16))
        self.assertEqual(shown(chores)["Dishes"], False)            # tomorrow it's due again

    def test_a_moved_date_never_seen_due_today_is_not_done(self):
        # Renaming a future chore changes nothing on the board.
        _, chores, _ = plan(ALL, {}, Memory(), TODAY)
        self.assertNotIn("Clean Bath", shown(chores))

    def test_non_repeating_done_today_then_gone(self):
        once = item("ff", "Tidy shoes - Sarina", None, freq=None, completed=True, completed_on=TODAY)
        _, chores, _ = plan([once], {}, Memory(), TODAY)
        self.assertEqual(shown(chores), {"Tidy shoes": True})
        _, chores, _ = plan([once], {}, Memory(), date(2026, 11, 16))
        self.assertEqual(chores, [])


class BoardTaps(unittest.TestCase):
    def setUp(self):
        _, self.chores, self.mem = plan(ALL, {}, Memory(), TODAY)

    def test_a_tap_moves_the_due_date_past_today(self):
        writes, chores, mem = plan(ALL, {DISHES.id: True, TABLE.id: False}, self.mem, TODAY)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].due, day(16))
        self.assertEqual(shown(chores)["Dishes"], True)
        self.assertEqual(mem.pushed[DISHES.id], True)

    def test_an_overdue_tap_skips_to_the_first_day_after_today(self):
        overdue = item("ee", "Plants - Mariko", day(12), interval=2)
        _, _, mem = plan([overdue], {}, Memory(), TODAY)
        writes, _, _ = plan([overdue], {overdue.id: True}, mem, TODAY)
        self.assertEqual(writes[0].due, day(16))                    # 12 → 14 → 16

    def test_undo_puts_the_old_date_back(self):
        _, _, mem = plan(ALL, {DISHES.id: True}, self.mem, TODAY)
        moved = item("aa", "Dishes - Mariko", day(16))
        writes, chores, mem = plan([moved, TABLE, BATH, VACUUM], {DISHES.id: False}, mem, TODAY)
        self.assertEqual(writes[0].due, day(15))
        self.assertEqual(shown(chores)["Dishes"], False)
        self.assertNotIn(DISHES.id, mem.ticks)

    def test_undo_of_a_phone_tick_steps_back_one(self):
        _, _, mem = plan(ALL, {}, self.mem, TODAY)
        moved = item("aa", "Dishes - Mariko", day(16))
        _, _, mem = plan([moved, TABLE, BATH, VACUUM], {}, mem, TODAY)   # board now shows it done
        writes, _, _ = plan([moved, TABLE, BATH, VACUUM], {DISHES.id: False}, mem, TODAY)
        self.assertEqual(writes[0].due, day(15))

    def test_no_write_when_the_board_matches_what_was_pushed(self):
        writes, _, _ = plan(ALL, {DISHES.id: False, TABLE.id: False}, self.mem, TODAY)
        self.assertEqual(writes, [])

    def test_a_chore_the_sync_never_pushed_is_not_a_tap(self):
        writes, _, _ = plan(ALL, {DISHES.id: True}, Memory(), TODAY)
        self.assertEqual(writes, [])

    def test_the_phone_already_agrees(self):
        moved = item("aa", "Dishes - Mariko", day(16))
        writes, _, _ = plan([moved, TABLE, BATH, VACUUM], {DISHES.id: True}, self.mem, TODAY)
        self.assertEqual(writes, [])

    def test_non_repeating_tap_completes(self):
        once = item("ff", "Tidy shoes - Sarina", day(15), freq=None)
        _, _, mem = plan([once], {}, Memory(), TODAY)
        writes, chores, _ = plan([once], {once.id: True}, mem, TODAY)
        self.assertEqual((writes[0].completed, writes[0].due), (True, None))
        self.assertEqual(shown(chores), {"Tidy shoes": True})


class Memory_(unittest.TestCase):
    def test_round_trips_and_survives_junk(self):
        m = Memory(pushed={"r-a": True}, seen={"r-a": "2026-11-15"}, ticks={})
        self.assertEqual(Memory.from_json(m.to_json()), m)
        self.assertEqual(Memory.from_json("nope"), Memory())

    def test_board_id_is_short_and_valid(self):
        self.assertEqual(item("A1B2-C3", "x", None).id, "r-a1b2-c3")


if __name__ == "__main__":
    unittest.main()
