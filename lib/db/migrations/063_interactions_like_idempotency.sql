-- A buyer can have at most one effective like for a post.
-- Remove duplicates created before the idempotency boundary existed so the
-- unique index can be installed on long-lived databases as well as fresh ones.
WITH duplicate_likes AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY user_id, post_id
        ORDER BY created_at, id
      ) AS duplicate_number
    FROM interactions
    WHERE type = 'like'
      AND post_id IS NOT NULL
  ) ranked
  WHERE duplicate_number > 1
)
DELETE FROM interactions
WHERE id IN (SELECT id FROM duplicate_likes);

CREATE UNIQUE INDEX IF NOT EXISTS interactions_one_like_per_user_post
  ON interactions (user_id, post_id)
  WHERE type = 'like'
    AND post_id IS NOT NULL;