-- 121: Hashtag index + hashtag follows.
-- post_hashtags mirrors posts.hashtags (normalised); post status/moderation is
-- applied at read time by joining posts, so no status column is stored here.
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS post_hashtags_tag_created_idx ON post_hashtags (tag, created_at DESC);
CREATE INDEX IF NOT EXISTS post_hashtags_tag_prefix_idx ON post_hashtags (tag text_pattern_ops);

CREATE TABLE IF NOT EXISTS hashtag_follows (
  user_id    TEXT NOT NULL,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX IF NOT EXISTS hashtag_follows_user_idx ON hashtag_follows (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hashtag_follows_tag_idx ON hashtag_follows (tag);

-- Idempotent backfill from the legacy posts.hashtags json array: strip '#',
-- NFKC-normalise, lowercase, keep word characters, cap at 30 chars / 30 tags.
INSERT INTO post_hashtags (post_id, tag, created_at)
SELECT p.id, t.tag, p.created_at
FROM posts p
CROSS JOIN LATERAL (
  SELECT DISTINCT tag FROM (
    SELECT left(lower(regexp_replace(normalize(v, NFKC), '[^\w]', '', 'g')), 30) AS tag
    FROM json_array_elements_text(
      CASE WHEN json_typeof(p.hashtags) = 'array' THEN p.hashtags ELSE '[]'::json END
    ) AS v
    LIMIT 30
  ) raw WHERE tag <> ''
) t
ON CONFLICT (post_id, tag) DO NOTHING;
