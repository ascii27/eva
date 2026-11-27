import tempfile
import unittest
from pathlib import Path

import eva_slack as es

DESK = es.DESK


def msg(ts, user=DESK, text="", thread_ts=None):
    m = {"ts": ts, "user": user, "text": text}
    if thread_ts:
        m["thread_ts"] = thread_ts
    return m


class ParseEnv(unittest.TestCase):
    def test_quotes_export_and_comments(self):
        env = es.parse_env('# c\nexport A="x y"\nB=\'z\'\nC=plain=still\n\nnoequals\n')
        self.assertEqual(env, {"A": "x y", "B": "z", "C": "plain=still"})


class BotToken(unittest.TestCase):
    def test_environment_wins(self):
        self.assertEqual(es.bot_token({"SLACK_BOT_TOKEN": "from-env"}), "from-env")

    def test_falls_back_to_hermes_env_file(self):
        with tempfile.TemporaryDirectory() as home:
            Path(home, ".env").write_text('SLACK_BOT_TOKEN="from-file"\n')
            self.assertEqual(es.bot_token({"HERMES_HOME": home}), "from-file")

    def test_missing_everywhere_exits(self):
        with tempfile.TemporaryDirectory() as home, self.assertRaises(SystemExit):
            es.bot_token({"HERMES_HOME": home})


class StripMention(unittest.TestCase):
    def test_leading_mentions_removed(self):
        self.assertEqual(es.strip_mention("<@U0B7PD9CWSX> Battery reading"), "Battery reading")
        self.assertEqual(es.strip_mention("no mention"), "no mention")


class FindAnswer(unittest.TestCase):
    BATTERY = "<@U0B7PD9CWSX> Battery reading you asked for: The desk phone's battery is at 82 percent and charging."

    def test_finds_desk_reply_after_the_ask(self):
        found = es.find_answer([msg("10.0", text=self.BATTERY)], "battery", "9.0")
        self.assertEqual(found["ts"], "10.0")

    def test_ignores_replies_older_than_the_ask(self):
        self.assertIsNone(es.find_answer([msg("8.0", text=self.BATTERY)], "battery", "9.0"))

    def test_ignores_other_senders_and_other_kinds(self):
        msgs = [msg("10.0", user="U0B7PD9CWSX", text=self.BATTERY),
                msg("11.0", text="<@U0B7PD9CWSX> Light reading you asked for: dark")]
        self.assertIsNone(es.find_answer(msgs, "battery", "9.0"))
        self.assertEqual(es.find_answer(msgs, "light", "9.0")["ts"], "11.0")

    def test_ignores_thread_replies(self):
        self.assertIsNone(es.find_answer([msg("10.0", text=self.BATTERY, thread_ts="5.0")], "battery", "9.0"))

    def test_location_failure_counts_as_an_answer(self):
        m = msg("10.0", text="<@U0B7PD9CWSX> I couldn't read the location: no permission.")
        self.assertEqual(es.find_answer([m], "location", "9.0")["ts"], "10.0")

    def test_earliest_matching_answer_wins(self):
        msgs = [msg("12.0", text=self.BATTERY), msg("10.0", text=self.BATTERY)]
        self.assertEqual(es.find_answer(msgs, "battery", "9.0")["ts"], "10.0")


class View(unittest.TestCase):
    def test_names_the_desk_and_me(self):
        self.assertEqual(es.view(msg("1.0", text="hi"), "UME")["from"], "desk")
        self.assertEqual(es.view(msg("1.0", user="UME"), "UME")["from"], "you")
        self.assertEqual(es.view(msg("1.0", user="UOTHER"), "UME")["from"], "UOTHER")

    def test_thread_ts_only_for_replies(self):
        self.assertNotIn("thread_ts", es.view(msg("1.0", thread_ts="1.0"), None))
        self.assertEqual(es.view(msg("2.0", thread_ts="1.0"), None)["thread_ts"], "1.0")


class AsksMatchTheDevice(unittest.TestCase):
    """The prefixes are copied from device code; fail loudly if it drifts."""

    def test_prefixes_present_in_device_source(self):
        root = Path(__file__).resolve().parents[4]
        src = "".join((root / p).read_text() for p in
                      ("src/device/battery.ts", "src/device/screen.ts", "src/location/place.ts"))
        for kind, (_, prefixes) in es.ASKS.items():
            for prefix in prefixes:
                self.assertIn(prefix.rstrip(), src, f"{kind}: {prefix!r}")


if __name__ == "__main__":
    unittest.main()
