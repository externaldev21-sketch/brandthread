-- Do not remove deleted user rows: their Clerk subject is a tombstone that
-- prevents delayed mobile sync requests from re-creating an erased profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;