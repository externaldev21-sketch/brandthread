-- ─── Migration 271: Founding Seller badge (first 100 sellers) ────────────────
-- users.founding_seller_number is 1..100, unique, and never reused. New sellers
-- get the next number when they complete seller onboarding (api-server
-- lib/foundingSellers.ts, serialized by the same advisory lock used below).
--
-- Backfill: the earliest real sellers by created_at, up to 100 in total.
-- Excluded: deleted / deletion-pending / suspended accounts, App Review demo
-- accounts, the system account, and test-signature emails (lib/db
-- testing/signatures.ts TEST_EMAIL_TLD_PATTERN). Idempotent: rows that already
-- have a number keep it, and a re-run only fills numbers still free.

ALTER TABLE users ADD COLUMN IF NOT EXISTS founding_seller_number INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_founding_seller_number_range'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_founding_seller_number_range
      CHECK (founding_seller_number IS NULL OR founding_seller_number BETWEEN 1 AND 100);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_founding_seller_number_uq
  ON users (founding_seller_number)
  WHERE founding_seller_number IS NOT NULL;

SELECT pg_advisory_xact_lock(hashtext('founding_seller_number'));

WITH taken AS (
  SELECT COALESCE(MAX(founding_seller_number), 0) AS max_n FROM users
),
candidates AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.created_at, u.id) AS rn
  FROM users u
  WHERE u.founding_seller_number IS NULL
    AND u.account_type IN ('seller', 'both')
    AND u.onboarding_complete = true
    AND u.deleted_at IS NULL
    AND u.deletion_requested_at IS NULL
    AND u.suspended_at IS NULL
    AND u.is_review_account = false
    AND u.is_system_account = false
    AND lower(u.email) !~ '@([a-z0-9-]+\.)*(test|invalid|example|local|localhost)$'
)
UPDATE users u
SET founding_seller_number = taken.max_n + c.rn
FROM candidates c, taken
WHERE u.id = c.id
  AND taken.max_n + c.rn <= 100;
