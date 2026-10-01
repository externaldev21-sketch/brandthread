-- 112: Account deletion 30-day grace period + re-auth email codes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_cancelled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_deletion_scheduled_idx ON users (deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS account_deletion_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id   TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_deletion_codes_clerk_idx ON account_deletion_codes (clerk_id, created_at);
