-- A user can have at most one effective repost for a post.
-- Keep the oldest durable row when repairing databases that predate this
-- idempotency boundary.
WITH duplicate_reposts AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY user_id, post_id
        ORDER BY created_at, id
      ) AS duplicate_number
    FROM interactions
    WHERE type = 'repost'
      AND post_id IS NOT NULL
  ) ranked
  WHERE duplicate_number > 1
)
DELETE FROM interactions
WHERE id IN (SELECT id FROM duplicate_reposts);

CREATE UNIQUE INDEX IF NOT EXISTS interactions_one_repost_per_user_post
  ON interactions (user_id, post_id)
  WHERE type = 'repost'
    AND post_id IS NOT NULL;