-- Migration 094: password reset codes for the server-issued (Resend-backed)
-- forgot-password flow. The 6-digit code is never stored in plaintext — only
-- a SHA-256 hash is persisted — and each row is single-use (used_at) with a
-- 15-minute expiry enforced at write time.
--
-- clerk_id is looked up from the email at request time and stored so confirm
-- doesn't need a second Clerk lookup; email is kept (lowercased/trimmed) for
-- rate-limiting by identity even before a code exists.

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  clerk_id    TEXT        NOT NULL,
  code_hash   TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_codes_email_idx
  ON password_reset_codes (email, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_codes_expires_at_idx
  ON password_reset_codes (expires_at);
