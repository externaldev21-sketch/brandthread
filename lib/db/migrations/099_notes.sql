-- 099: Notes bubble above story avatars (IG "Notes")
-- Each user has at most one active note at a time (24h TTL, mirroring how
-- stories.expires_at is computed) — posting a new note replaces the old one.
-- Kept as its own small table (rather than a field on `users`) so the note
-- has its own independent createdAt/expiresAt lifecycle and stays a purely
-- additive, easily-prunable feature, matching how `stories` is separate
-- from `users` rather than a column on it.

CREATE TABLE IF NOT EXISTS notes (
  id                  UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id           TEXT    NOT NULL,            -- Clerk user ID
  author_name         TEXT    NOT NULL,
  author_handle       TEXT,
  author_initials     TEXT,
  author_color        TEXT,
  text                TEXT    NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- One active note per author: a new post upserts by author_id rather than
-- inserting a second row, so "only one active note at a time" holds even
-- under a race between two requests from the same user.
CREATE UNIQUE INDEX IF NOT EXISTS notes_author_unique_idx ON notes (author_id);
CREATE INDEX IF NOT EXISTS notes_expires_idx ON notes (expires_at);
