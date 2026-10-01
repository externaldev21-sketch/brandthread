-- One "started a live show" alert per follower and stream, so a retried
-- fan-out never notifies the same person twice.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_live_started_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'live_started' AND target_id IS NOT NULL;
