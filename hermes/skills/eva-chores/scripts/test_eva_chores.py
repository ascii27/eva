import datetime as dt
import unittest

import eva_chores as ec

TOKYO = dt.timezone(dt.timedelta(hours=9))
NOON_MS = int(dt.datetime(2026, 11, 16, 12, 0, tzinfo=TOKYO).timestamp() * 1000)


def done_ev(**kw):
    ev = {"id": "ev-1", "seq": 1, "at": NOON_MS, "who": "mariko", "delta": 100,
          "type": "done", "choreId": "dishes", "title": "Dishes", "amount": 100}
    ev.update(kw)
    return ev


def row(**kw):
    r = {"Board id": "dishes", "Name": "Dishes", "Who": "Mariko", "Icon": "Plate",
         "Amount ¥": 100, "Every": 1, "Unit": "Day", "Start": "2026-11-16", "Active": True}
    r.update(kw)
    return r


class LedgerRow(unittest.TestCase):
    def test_done_row(self):
        r = ec.ledger_row(done_ev(), "log-a")
        self.assertEqual(r["Amount ¥"], 100)
        self.assertEqual(r["Who"], "Mariko")
        self.assertEqual(r["At"], "2026-11-16T12:00:00+09:00")
        self.assertEqual(r["Board log id"], "log-a")
        self.assertEqual(r["Type"], "done")
        self.assertEqual(r["Chore"], "Dishes")
        self.assertEqual(r["Chore id"], "dishes")
        self.assertEqual(r["Event id"], "ev-1")
        self.assertEqual((r["Cancels"], r["Source"], r["Note"]), ("", "", ""))

    def test_payment_row_is_negative(self):
        ev = {"id": "ev-2", "seq": 2, "at": NOON_MS, "who": "sarina", "delta": -500,
              "type": "payment", "amount": 500, "source": "board", "note": None}
        r = ec.ledger_row(ev, "log-a")
        self.assertEqual(r["Amount ¥"], -500)
        self.assertEqual(r["Source"], "board")
        self.assertEqual(r["Chore"], "")
        self.assertEqual(r["Note"], "")

    def test_payment_note(self):
        ev = {"id": "ev-2", "seq": 2, "at": NOON_MS, "who": "sarina", "delta": -500,
              "type": "payment", "amount": 500, "source": "eva", "note": "cash"}
        self.assertEqual(ec.ledger_row(ev, "l")["Note"], "cash")

    def test_undone_row_cancels(self):
        ev = {"id": "ev-3", "seq": 3, "at": NOON_MS, "who": "mariko", "delta": -100,
              "type": "undone", "cancels": "ev-1", "choreId": None, "title": None}
        r = ec.ledger_row(ev, "log-a")
        self.assertEqual(r["Cancels"], "ev-1")
        self.assertEqual(r["Amount ¥"], -100)
        self.assertEqual((r["Chore"], r["Chore id"]), ("", ""))

    def test_unknown_who_is_capitalised(self):
        self.assertEqual(ec.ledger_row(done_ev(who="anyone"), "l")["Who"], "Anyone")


class Check(unittest.TestCase):
    def test_check_first_run_no_alarm(self):
        self.assertIsNone(ec.check(None, {"logId": "a", "seq": 0}))

    def test_check_log_replaced(self):
        a = ec.check({"logId": "a", "seq": 5}, {"logId": "b", "seq": 9})
        self.assertEqual(a["kind"], "log-replaced")
        self.assertEqual(a["expected"], {"logId": "a", "seq": 5})
        self.assertEqual(a["found"], {"logId": "b", "seq": 9})

    def test_check_seq_went_back(self):
        a = ec.check({"logId": "a", "seq": 5}, {"logId": "a", "seq": 3})
        self.assertEqual(a["kind"], "seq-went-back")

    def test_check_same_log_ahead_ok(self):
        self.assertIsNone(ec.check({"logId": "a", "seq": 5}, {"logId": "a", "seq": 5}))
        self.assertIsNone(ec.check({"logId": "a", "seq": 5}, {"logId": "a", "seq": 8}))


class ChoreDefs(unittest.TestCase):
    def test_chore_defs_maps_and_filters_inactive(self):
        out = ec.chore_defs([row(), row(**{"Board id": "bath", "Active": False})])
        self.assertEqual(out, [{
            "id": "dishes", "title": "Dishes", "who": "mariko", "icon": "plate",
            "amount": 100, "schedule": {"every": 1, "unit": "day", "start": "2026-11-16"},
        }])

    def test_notion_date_with_time(self):
        out = ec.chore_defs([row(Start="2026-11-16T00:00:00.000+09:00", Icon="")])
        self.assertEqual(out[0]["schedule"]["start"], "2026-11-16")
        self.assertIsNone(out[0]["icon"])

    def test_active_must_be_exactly_true(self):
        self.assertEqual(ec.chore_defs([row(Active="true"), row(Active=None)]), [])

    def test_blank_who_is_anyone(self):
        self.assertIsNone(ec.chore_defs([row(Who="")])[0]["who"])

    def test_who_case_insensitive(self):
        self.assertEqual(ec.chore_defs([row(Who="SARINA")])[0]["who"], "sarina")

    def test_chore_defs_rejects_fractional_amount(self):
        self.assertIsInstance(ec.chore_defs([row(**{"Amount ¥": 12.5})]), str)
        self.assertIsInstance(ec.chore_defs([row(**{"Amount ¥": -1})]), str)
        self.assertIsInstance(ec.chore_defs([row(**{"Amount ¥": True})]), str)

    def test_integral_float_amount_ok(self):
        self.assertEqual(ec.chore_defs([row(**{"Amount ¥": 100.0})])[0]["amount"], 100)

    def test_chore_defs_rejects_duplicate_ids(self):
        self.assertIn("duplicate", ec.chore_defs([row(), row()]))

    def test_chore_defs_unknown_who_is_error(self):
        self.assertIn("Taro", ec.chore_defs([row(Who="Taro")]))

    def test_missing_board_id(self):
        self.assertIn("Board id", ec.chore_defs([row(**{"Board id": ""})]))

    def test_bad_every_unit_date(self):
        self.assertIsInstance(ec.chore_defs([row(Every=0)]), str)
        self.assertIsInstance(ec.chore_defs([row(Unit="month")]), str)
        self.assertIsInstance(ec.chore_defs([row(Start="2026-13-45")]), str)
        self.assertIsInstance(ec.chore_defs([row(Start="")]), str)


class NewChoreId(unittest.TestCase):
    def test_new_chore_id_slug_and_suffix(self):
        self.assertEqual(ec.new_chore_id("Wash the dishes", set()), "chore-wash-the-dishes")
        self.assertEqual(ec.new_chore_id("Wash the dishes", {"chore-wash-the-dishes"}), "chore-wash-the-dishes-2")
        self.assertEqual(ec.new_chore_id("Wash the dishes", {"chore-wash-the-dishes", "chore-wash-the-dishes-2"}),
                         "chore-wash-the-dishes-3")
        self.assertEqual(ec.new_chore_id("お皿", set()), "chore-1")
        self.assertEqual(ec.new_chore_id("お皿", {"chore-1"}), "chore-2")

    def test_long_name_stays_valid(self):
        i = ec.new_chore_id("x" * 200, set())
        self.assertLessEqual(len(i), 64)


if __name__ == "__main__":
    unittest.main()
