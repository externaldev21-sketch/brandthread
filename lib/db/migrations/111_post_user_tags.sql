-- 111: People tags on posts — drives the profile "Tagged" tab.
CREATE TABLE IF NOT EXISTS post_user_tags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tagged_user_id TEXT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_user_tags_tagged_idx ON post_user_tags (tagged_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS post_user_tags_unique ON post_user_tags (post_id, tagged_user_id);
