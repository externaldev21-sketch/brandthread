-- 316: Server-side person mutes and restrictions (previously phone-only).
-- user_mutes: one-way; the muter stops seeing the muted person's posts and/or
-- stories (and their comments) everywhere. The muted person is never told.
-- user_restrictions: a restricted person's comments on the restrictor's posts
-- are only visible to the restricted person themselves.
CREATE TABLE IF NOT EXISTS user_mutes (
  muter_id     TEXT NOT NULL,
  muted_id     TEXT NOT NULL,
  mute_posts   BOOLEAN NOT NULL DEFAULT TRUE,
  mute_stories BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (muter_id, muted_id)
);

CREATE TABLE IF NOT EXISTS user_restrictions (
  restrictor_id TEXT NOT NULL,
  restricted_id TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restrictor_id, restricted_id)
);
CREATE INDEX IF NOT EXISTS user_restrictions_restricted_id_idx ON user_restrictions (restricted_id);
