# Usage: uv run --with "psycopg[binary]" python data/load_chinook.py
# Needs DATABASE_URL_OWNER and READONLY_PASSWORD in the environment. Runs with the owner role only.
import os, re, pathlib
import psycopg
from psycopg import sql

root = pathlib.Path(__file__).parent
raw = (root / "raw" / "Chinook_PostgreSql.sql").read_text(encoding="utf-8")
# A shared server (and Neon) does not allow creating or switching database from a script.
raw = re.sub(r"(?im)^\s*(DROP|CREATE)\s+DATABASE\b.*?;\s*$", "", raw)
raw = re.sub(r"(?im)^\s*\\c\b.*$", "", raw)

# The script has plain CREATE TABLE statements, so a second run would fail. Drop its tables first.
TABLES = ["playlist_track", "playlist", "invoice_line", "invoice", "customer", "employee",
          "track", "album", "artist", "genre", "media_type"]

url = os.environ["DATABASE_URL_OWNER"]
pw = os.environ["READONLY_PASSWORD"]
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
    conn.execute((root / "roles.sql").read_text(encoding="utf-8"))
    n = conn.execute("SELECT count(*) FROM app.customers").fetchone()[0]
    print("customers loaded:", n)
