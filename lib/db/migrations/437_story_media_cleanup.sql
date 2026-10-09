-- Object-storage cleanup queue for story media.
--
-- The story cleanup job enqueues the media object paths of expired stories
-- that are not archived, and of story_archive rows pruned after a year, in the
-- same transaction that deletes those rows. A later step of the same job
-- re-checks that nothing else still references each path (other stories, the
-- archive, highlights, posts, products, moderation records) before deleting
-- the object, so a crash between the two steps never leaks or wrongly deletes.
CREATE TABLE IF NOT EXISTS story_media_cleanup (
  object_path     TEXT PRIMARY KEY,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS story_media_cleanup_due_idx
  ON story_media_cleanup (next_attempt_at);
