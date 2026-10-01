-- ─── Migration 240: internal App Review demo accounts ─────────────────────────
-- Flags the demo buyer/seller that the App Store / Google Play reviewers sign
-- in with (seeded by artifacts/api-server/scripts/seedReviewAccounts.ts).
-- The flag exists so the test-data purge (lib/db/src/testing/purge.ts) and any
-- future analytics/ranking exclusion can tell these rows apart from real users.
-- Idempotent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_review_account BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_review_account_idx
  ON users (is_review_account)
  WHERE is_review_account = true;
