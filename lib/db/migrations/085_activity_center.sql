-- Migration 085: Activity Center support on the shared notifications feed.
--
-- actor_id          Clerk user ID of whoever caused the event, so the Activity
--                   Center can aggregate distinct actors ("Jay and 12 others")
--                   and publishers can ignore repeat like/unlike toggles.
-- target_image_url  Thumbnail of the related post/product/order. Absolute URL
--                   or a private /objects/… path signed when the feed is read.
ALTER TABLE notifications_feed
  ADD COLUMN IF NOT EXISTS actor_id text,
  ADD COLUMN IF NOT EXISTS target_image_url text;

-- The feed is always read per user, newest first, and now paginated.
CREATE INDEX IF NOT EXISTS notifications_feed_user_created_idx
  ON notifications_feed (user_id, created_at);

-- One new-product alert per follower and product, and one payout alert per
-- Stripe payout. Remove any duplicates before adding the unique boundaries.
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
    WHERE type IN ('new_product', 'payout_sent')
      AND target_id IS NOT NULL
  ) ranked
  WHERE duplicate_number > 1
)
DELETE FROM notifications_feed
WHERE id IN (SELECT id FROM duplicate_notifications);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_new_product_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'new_product'
    AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_payout_sent_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'payout_sent'
    AND target_id IS NOT NULL;
