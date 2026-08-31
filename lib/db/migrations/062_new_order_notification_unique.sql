-- Only one new-order alert may exist for a seller and order.
-- Remove duplicates created before the database idempotency boundary existed.
WITH duplicate_notifications AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY user_id, type, target_id
        ORDER BY created_at, id
      ) AS duplicate_number
    FROM notifications_feed
    WHERE type = 'new_order_received'
      AND target_id IS NOT NULL
  ) ranked
  WHERE duplicate_number > 1
)
DELETE FROM notifications_feed
WHERE id IN (SELECT id FROM duplicate_notifications);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_new_order_received_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'new_order_received'
    AND target_id IS NOT NULL;