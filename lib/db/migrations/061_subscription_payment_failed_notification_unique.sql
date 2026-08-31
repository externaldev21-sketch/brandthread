-- Only one recovery notification may exist for a seller and failed invoice.
-- Remove any duplicates created before the database boundary existed so the
-- unique index can be installed on long-lived databases as well as fresh ones.
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
    WHERE type = 'subscription_payment_failed'
      AND target_id IS NOT NULL
  ) ranked
  WHERE duplicate_number > 1
)
DELETE FROM notifications_feed
WHERE id IN (SELECT id FROM duplicate_notifications);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_subscription_payment_failed_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'subscription_payment_failed'
    AND target_id IS NOT NULL;