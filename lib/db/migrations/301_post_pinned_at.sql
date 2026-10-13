-- Pinned posts (Instagram "Pin to your profile"): up to 3 per author, shown
-- first on the profile grid, most recently pinned first. NULL = not pinned.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS posts_user_pinned_idx ON posts (user_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;
