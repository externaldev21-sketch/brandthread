-- 118: Private accounts (follow requests) + Close Friends list.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requester_id, target_id)
);
CREATE INDEX IF NOT EXISTS follow_requests_target_idx ON follow_requests (target_id, created_at);

CREATE TABLE IF NOT EXISTS close_friends (
  owner_id   TEXT NOT NULL,
  friend_id  TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, friend_id)
);
CREATE INDEX IF NOT EXISTS close_friends_friend_idx ON close_friends (friend_id);
