# Usage: uv run --with "psycopg[binary]" python data/load_chinook.py [--confirm]
# Needs DATABASE_URL_OWNER and READONLY_PASSWORD in the environment. Runs with the owner role only.
# READONLY_PASSWORD must be at least 12 characters and not 'change-me'. For any host other than
# localhost or 127.0.0.1 (for example Neon) the script refuses to run without --confirm, because it
# drops the 11 public Chinook tables with CASCADE. See loader_guard.py.
import os, re, sys, pathlib

root = pathlib.Path(__file__).parent
sys.path.insert(0, str(root))
import loader_guard

# Checks come first, before anything is read or any connection is opened.
url = os.environ.get("DATABASE_URL_OWNER", "")
pw = os.environ.get("READONLY_PASSWORD", "")
if not url:
    sys.exit("DATABASE_URL_OWNER is not set (length 0).")
problem = loader_guard.check(url, pw, sys.argv[1:])
if problem:
    sys.exit(problem)

import psycopg
from psycopg import sql

raw = (root / "raw" / "Chinook_PostgreSql.sql").read_text(encoding="utf-8")
# A shared server (and Neon) does not allow creating or switching database from a script.
raw = re.sub(r"(?im)^\s*(DROP|CREATE)\s+DATABASE\b.*?;\s*$", "", raw)
raw = re.sub(r"(?im)^\s*\\c\b.*$", "", raw)

# The script has plain CREATE TABLE statements, so a second run would fail. Drop its tables first.
TABLES = ["playlist_track", "playlist", "invoice_line", "invoice", "customer", "employee",
          "track", "album", "artist", "genre", "media_type"]

with psycopg.connect(url, autocommit=True) as conn:
    conn.execute("DROP SCHEMA IF EXISTS app CASCADE")
    for t in TABLES:
        conn.execute(sql.SQL("DROP TABLE IF EXISTS public.{} CASCADE").format(sql.Identifier(t)))
    conn.execute(raw)
    conn.execute((root / "views.sql").read_text(encoding="utf-8"))
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly'").fetchone()
    verb = "ALTER ROLE app_readonly" if exists else "CREATE ROLE app_readonly LOGIN"
    conn.execute(sql.SQL(verb + " PASSWORD {}").format(sql.Literal(pw)))
    db = conn.execute("SELECT current_database()").fetchone()[0]
    conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO app_readonly").format(sql.Identifier(db)))
    # TEMP on a database comes through PUBLIC by default. Take it away so the app role cannot
    # create temporary tables, even inside a read-write transaction.
    conn.execute(sql.SQL("REVOKE TEMP ON DATABASE {} FROM PUBLIC").format(sql.Identifier(db)))
    conn.execute(sql.SQL("REVOKE TEMP ON DATABASE {} FROM app_readonly").format(sql.Identifier(db)))
    conn.execute((root / "roles.sql").read_text(encoding="utf-8"))
    n = conn.execute("SELECT count(*) FROM app.customers").fetchone()[0]
    print("customers loaded:", n)
