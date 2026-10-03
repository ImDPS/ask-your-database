-- Grants for the read-only app role. The loader creates the role and sets its password.
-- No password and no database name here, so the file is safe to commit.
REVOKE ALL ON SCHEMA public FROM app_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_readonly;
GRANT USAGE ON SCHEMA app TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_readonly;
ALTER ROLE app_readonly SET search_path = app;
ALTER ROLE app_readonly SET default_transaction_read_only = on;
ALTER ROLE app_readonly SET statement_timeout = '5s';
