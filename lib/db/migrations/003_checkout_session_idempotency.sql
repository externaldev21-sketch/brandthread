-- Migration 003: Add client_idempotency_key to checkout_sessions
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and safe index replacement.
-- Apply with: psql $DATABASE_URL -f migrations/003_checkout_session_idempotency.sql

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT;

-- Drop any previously-created partial index (created by an earlier version of
-- this migration) so we can replace it with a non-partial unique index.
-- ON CONFLICT ... DO UPDATE requires a non-partial constraint that PostgreSQL
-- can infer from the column name; partial indexes cannot be used for that.
DROP INDEX IF EXISTS checkout_sessions_client_idempotency_key_key;

-- Non-partial unique index: allows multiple NULLs (PostgreSQL treats each NULL
-- as distinct), prevents duplicate non-NULL keys, and supports
-- ON CONFLICT (client_idempotency_key) DO UPDATE in application code.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_client_idempotency_key_uidx
  ON checkout_sessions (client_idempotency_key);
