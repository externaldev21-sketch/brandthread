-- Migration 211: public web account-deletion requests (Google Play "account
-- deletion URL" requirement). A person who cannot or will not open the app
-- asks for deletion by email; we mail a single-use link, and only a confirmed
-- link runs the existing account deletion (routes/auth.ts accountDeletionHandler).
-- The token itself is never stored, only its SHA-256 hash.

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  clerk_id      TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  expires_at    TIMESTAMPTZ NOT NULL,
  confirmed_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_token_hash_idx
  ON account_deletion_requests (token_hash);

CREATE INDEX IF NOT EXISTS account_deletion_requests_email_idx
  ON account_deletion_requests (email, created_at DESC);
