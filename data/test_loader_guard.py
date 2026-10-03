# Self-test for the loader's safety checks. No database needed.
# Run: python data/test_loader_guard.py   (or: uv run python data/test_loader_guard.py)
import pathlib, sys, unittest, io, contextlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import loader_guard as g

GOOD = "a-long-throwaway-pw"          # 19 characters
LOCAL = "postgres://postgres:secretvalue@localhost:5433/chinook"
NEON = "postgres://owner:secretvalue@ep-example-123.us-east-2.aws.neon.tech/neondb?sslmode=require"


class Guard(unittest.TestCase):
    def test_placeholder_refused_even_locally(self):
        self.assertIn("placeholder", g.check(LOCAL, "change-me", []))

    def test_short_password_refused(self):
        self.assertIn("shorter than 12", g.check(LOCAL, "elevenchars", []))

    def test_empty_password_refused(self):
        self.assertIn("shorter than 12", g.check(LOCAL, "", []))

    def test_local_hosts_run_without_confirm(self):
        self.assertIsNone(g.check(LOCAL, GOOD, []))
        self.assertIsNone(g.check(LOCAL.replace("localhost", "127.0.0.1"), GOOD, []))

    def test_remote_without_confirm_refused_and_names_host_and_db_only(self):
        msg = g.check(NEON, GOOD, [])
        self.assertIn("ep-example-123.us-east-2.aws.neon.tech", msg)
        self.assertIn("neondb", msg)
        self.assertIn("--confirm", msg)
        self.assertNotIn("secretvalue", msg)
        self.assertNotIn("owner", msg.replace("loader", ""))   # the user name never appears

    def test_remote_with_confirm_prints_only_host_and_db(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertIsNone(g.check(NEON, GOOD, ["--confirm"]))
        out = buf.getvalue()
        self.assertIn("neondb", out)
        self.assertNotIn("secretvalue", out)
        self.assertNotIn("owner", out)

    def test_remote_still_refused_with_weak_password_even_if_confirmed(self):
        self.assertIsNotNone(g.check(NEON, "short", ["--confirm"]))
        self.assertIsNotNone(g.check(NEON, "change-me", ["--confirm"]))

    def test_host_override_in_query_string_counts_as_remote(self):
        url = "postgres://u:p@localhost/db?host=db.example.com"
        self.assertIn("db.example.com", g.check(url, GOOD, []))

    def test_multi_host_and_no_host_are_not_local(self):
        self.assertIsNotNone(g.check("postgres://u:p@localhost,db.example.com/db", GOOD, []))
        self.assertIsNotNone(g.check("postgres:///db", GOOD, []))

    def test_password_with_at_sign_and_colon_does_not_confuse_host(self):
        hosts, db = g.target_of("postgres://u:p%40ss:w@ord@db.example.com:5432/x")
        self.assertEqual((hosts, db), (["db.example.com"], "x"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
