-- Migration 432: remove the case-sensitive UNIQUE constraints on
-- users.username / users.email that the Drizzle schema used to declare
-- (`.unique()` -> users_username_unique / users_email_unique).
--
-- Migration 109 made uniqueness case-insensitive (users_username_ci_unique on
-- lower(username), users_email_ci_unique on lower(email)) and routes map a
-- unique violation to a 409 only when the violated name is the *_ci_unique
-- index. A leftover case-sensitive constraint is strictly weaker (redundant)
-- but fires first for exact duplicates, turning a clean 409 into a 500.
-- The schema now declares only the lower() indexes, so `drizzle-kit push` no
-- longer recreates these.
--
-- Each constraint is dropped only when its case-insensitive replacement
-- exists, so uniqueness is never left unenforced.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'users_username_ci_unique') THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'users_email_ci_unique') THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
  END IF;
END $$;
