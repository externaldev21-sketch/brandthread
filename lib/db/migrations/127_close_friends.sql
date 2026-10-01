-- ─── Migration 127: server-backed Close Friends list ─────────────────────────
-- Stories posted with privacy_visibility = 'close_friends' are visible only to
-- the author and the people in the author's close_friends rows.
CREATE TABLE IF NOT EXISTS close_friends (
  user_id    TEXT NOT NULL,
  friend_id  TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS close_friends_friend_idx ON close_friends (friend_id);
