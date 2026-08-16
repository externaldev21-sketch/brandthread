-- 010: Buyer-to-buyer follows (one-way social graph)
-- follower_id / following_id are Clerk user IDs.
-- Mutual follows (A→B and B→A) are treated as "friends" in the UI.

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- Efficient lookup of "who follows a given user"
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id);
