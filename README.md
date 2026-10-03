# Ask your database

Ask a question about a music store's sales in plain English. The app writes the SQL, checks it, runs it against a read-only copy of the data, and shows you the answer together with the SQL that produced it, so you can verify the work instead of trusting it.

Live demo: not deployed yet

![The page after running the first example: question box, example chips, the SQL, and a result table with the licence credit in the footer](assets/screenshot.png)

## Try it

Six example questions are built into the page. They return a stored answer instantly and make no model call:

- Which five countries bring in the most revenue?
- Who are the top 10 customers by total spend?
- Which genre sells best?
- How many tracks does each media type have?
- Which 10 artists have the most tracks?
- What was the revenue in each year?

Anything you type yourself goes to the language model (up to 300 characters). Opening `/?example=1` shows the first example directly.

## How it works

1. You type a question.
2. The model (Gemini, behind a small provider interface) is given the table structure and column descriptions, never any data rows, and writes one `SELECT`.
3. A Postgres-aware parser checks that the text is exactly one read-only query on the approved views.
4. The query runs as a read-only database role, inside a read-only transaction, with a time limit and a row limit.
5. The page shows the answer and the SQL. If the database rejects the query, the error is passed back to the model once for a retry.

```
question -> model writes SQL -> parser checks -> read-only database -> answer + SQL
                  ^                                      |
                  +------- one retry with the error -----+
```

## Safety

Any one of these layers is meant to stop a bad query on its own.

| Layer | What it does |
|---|---|
| Database role | The app connects as `app_readonly`, which can `SELECT` only from 11 described views in an `app` schema. The raw tables are not readable by it. A separate owner role is used only by the loader. |
| Validation | Exactly one `SELECT` (or `WITH ... SELECT`) is accepted. Writes, DDL, admin commands, catalogue reads, other schemas and dangerous functions such as `pg_sleep` and `set_config` are refused. |
| Database limits | `BEGIN READ ONLY`, a 5 second statement timeout, and at most 200 rows returned. |
| What the model sees | Structure and column descriptions only. The question is marked as a question, not as instructions. Personal-looking columns (addresses, phone numbers, email) are not exposed in the views at all. |
| Failure handling | A plain message, and at most one automatic retry. Server faults return a generic message, not internals. |

What is tested (counts are in "How it was verified" below):

- **Validator:** 243 rejection cases (stacked statements, writes inside CTEs, comment tricks, `U&` escapes that hide a function name, catalogue and `pg_` access, and more) and 33 accept cases.
- **Read-only role:** every attack statement is run twice, once normally and once inside an explicit `READ WRITE` transaction, so the grants are shown to hold without help from the read-only default. A direct read of a raw table is denied.
- **Executor:** timeout, row cap, no state leaking between requests, no connection details in error messages.
- **Rate limit and daily cap:** unit tests plus API tests, including that a refused request does not use up the daily cap.

## Cost control

- A per-client rate limit (5 requests a minute by default, `RATE_LIMIT_PER_MINUTE`).
- A daily cap on model calls (200 by default, `DAILY_LLM_CAP`).
- Six cached example answers that never call the model.
- Length limits: 300 characters for a question, a 4 KB request body, 400 output tokens for the model, 10,000 characters for a query.
- The Gemini key is meant to live in a Google project with no billing attached, so going over the free quota makes calls fail instead of costing money.

The rate limiter and the daily cap live in the server's memory. They reset when the container restarts, so they are for friendliness and for stopping a burst. The no-billing key is the real ceiling.

## Stack and why

- **Node 24, TypeScript, Express:** one small server for the API and the built page, with few dependencies.
- **`pgsql-ast-parser`:** a pure JavaScript parser for PostgreSQL, so there is no native build and it behaves the same on Windows and in the container.
- **`pg`:** the plain driver, with an explicit transaction for every query.
- **PostgreSQL 16:** the Chinook data and the read-only role. Docker locally, Neon's free plan in production.
- **React 19 and Vite:** a single page, about 71 kB gzipped, no external requests.
- **Gemini free tier, via plain `fetch`:** no SDK to keep up with, easy to fake in tests. A second provider can be added behind the same interface.
- **vitest and supertest:** server tests run against a real local Postgres, not a mock.
- **Docker:** one image runs the API and the page.

## Run it locally

You need Node 24, Docker, and [uv](https://docs.astral.sh/uv/) (it runs the Python loader and fetches its one dependency). Commands below are for a Bash shell; PowerShell notes follow.

1. Install and configure:
   ```bash
   npm install
   cp .env.example .env
   ```
   Edit `.env`: set `READONLY_PASSWORD` to a strong value (at least 12 characters, not `change-me`), put the same value in `DATABASE_URL_READONLY`, set `POSTGRES_PASSWORD` and put it in `DATABASE_URL_OWNER`. To run without a Gemini key, set `LLM_PROVIDER=fake`; the model then always answers with one fixed query, which is enough to see the page work.
2. Start the database (port 5433, bound to this machine only):
   ```bash
   npm run db:up
   ```
3. Download the Chinook script (MIT, version 1.4.5) and load it. The loader needs the variables from `.env` in its environment:
   ```bash
   mkdir -p data/raw
   curl -L -o data/raw/Chinook_PostgreSql.sql https://github.com/lerocha/chinook-database/releases/download/v1.4.5/Chinook_PostgreSql.sql
   set -a; . ./.env; set +a
   uv run --with "psycopg[binary]" python data/load_chinook.py
   ```
   It prints `customers loaded: 59`. Running it again is safe. For a database that is not on `localhost` it refuses to run unless you add `--confirm`, because it drops and recreates the 11 Chinook tables.
4. Run the tests. **They need the loaded database from step 3.**
   ```bash
   npm test
   ```
5. Start the app. Two terminals for development (the page on http://localhost:5173, proxying `/api` to the server on port 8080):
   ```bash
   npm run dev:server
   npm run dev:web
   ```
   Or build once and serve everything from port 8080:
   ```bash
   npm run build
   npm start
   ```

PowerShell: replace `cp` with `Copy-Item`, and load `.env` for the loader with:
```powershell
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }
```

## Deployment

The pattern is one container, a managed Postgres and a free model key. Nothing is deployed yet.

1. **Database:** create an empty Postgres database on Neon's free plan. Run the loader against it with the owner connection string and `--confirm`, and a strong `READONLY_PASSWORD`. The app then uses only the read-only role's connection string.
2. **Model key:** create a Gemini API key in a Google Cloud project that has no billing attached. Check the free-tier model names and limits on Google's rate-limit page, and set `GEMINI_MODEL` to a listed model (the default in the code is `gemini-2.5-flash-lite`, which is a configuration value, not a promise).
3. **Container:** `docker build -t ask-your-database .`, then deploy the image to Cloud Run with `--max-instances 1` so the in-memory guards stay meaningful, and pass `DATABASE_URL_READONLY`, `GEMINI_API_KEY`, `DAILY_LLM_CAP` and `RATE_LIMIT_PER_MINUTE` as environment values. Set `DAILY_LLM_CAP` to at most half of the real daily model limit (see Known limits).
4. **Check:** `node scripts/smoke-live.mjs <service URL>` runs five checks (health, page assets, a cached example, one live question, and an unsafe question that must not be obeyed).

## Known limits

- **A valid query can still answer the wrong question.** The SQL is shown so you can check it.
- **Some valid read-only SQL is refused.** `INTERSECT`, `EXCEPT`, `SELECT INTO`, `EXPLAIN`, `COPY` and a first query wrapped in brackets are rejected by the parser. The app fails closed rather than guess.
- **Duplicate output column names are rejected.** Two columns both called `id` produce a hint to give each column an alias, and the retry usually fixes it.
- **A database error can echo a value from the data** into the retry prompt (for example a bad-cast message). The error text is flattened to one line and capped at 300 characters.
- **The daily cap and rate limiter are in memory** and reset when the container restarts.
- **One question can cost two model calls** (the first try and the retry), but the daily cap counts one. Set the cap to at most half of the real model limit.
- **Privacy:** on the Gemini free tier, Google may use questions to improve its products and they may be read by people. The page tells visitors not to enter personal information.
- **The data is a sample database.** Its customers and sales are not real.
- **Types in the JSON:** numeric values from the database arrive as text (to keep exact decimals) and dates as ISO strings. The page right-aligns numeric-looking text and shows dates plainly.
- **Query cost is bounded by limits, not prevented.** Expensive but read-only queries are cut off by the 5 second timeout and the read-only role.

## How it was verified

All figures are from runs on a Windows machine with Node 24.19.0 and Docker 29.7.2. Anything not listed here is not measured.

| Fact | Result | Source |
|---|---|---|
| Server tests | 457 passed, 15 files | `npm test` (needs the loaded local database) |
| Web tests | 43 passed, 3 files | `npm test` |
| Total tests | 500 | server and web above |
| Validator cases | 283 (243 rejection, 33 accept, 7 output checks) | vitest JSON report for `server/test/validator.test.ts`, grouped by test group |
| Read-only role tests | 14 | `server/test/readonly-role.test.ts` |
| JavaScript bundle | 71.02 kB gzip (226.23 kB raw) | `npm run build` output, Vite; `gzip -9` gives 70,086 bytes |
| Docker image | 348 MB on disk | `docker images ask-your-database:local` |
| Cached example answer | about 6 to 9 ms, local, warm | `elapsedMs` from `/api/examples/1/answer`, five calls to the local container |
| Smoke script | 5 of 5 checks pass | `node scripts/smoke-live.mjs` against the local container with the fake model |
| Database | Chinook 1.4.5, 11 tables, 11 views, 10,111 kB | `pg_database_size`; largest views: `playlist_tracks` 8,715 rows, `tracks` 3,503, `invoice_lines` 2,240, `invoices` 412 |
| Gold answers | 10 golden questions, each with a view-based and an independent raw-table query that agree | `server/test/golden.test.ts` |

Not measured: model accuracy, live latency, cold start, Lighthouse scores, and behaviour on a real phone (the page was checked in headless Chrome at 360 pixels wide, in light and dark themes, where the table scrolls inside its box and the page does not widen).

**Model accuracy.** The ten golden questions can be run against the real model with your own key:
```bash
GEMINI_API_KEY=your-key npm run golden:live -w server
```
In PowerShell, set `$env:GEMINI_API_KEY = "your-key"` first.
It prints a line per question and a final score, quoted as "matches the gold answers after rounding fractions to 2 decimals". Ties at the edge of a top-10 list and a few phrasing differences can make a correct answer count as a difference, so read the printed SQL for any miss. No score is claimed here because it has not been run.

## Data credit and licence

The data is the Chinook sample database, version 1.4.5, MIT licence, Copyright (c) 2008-2024 Luis Rocha: https://github.com/lerocha/chinook-database

This project is MIT licensed. See [LICENSE](LICENSE).
