-- Migration 086: idempotency boundaries for the Activity tab's new event
-- types (repost, story/highlight like, Thread Cash received). Each is a
-- per-actor-per-target event, so — like new_product/payout_sent in 085 — a
-- partial unique index is the concurrency-safe de-dupe boundary for
-- publishNotification()'s ON CONFLICT DO NOTHING.

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_repost_unique
  ON notifications_feed (user_id, type, target_id, actor_id)
  WHERE type = 'repost'
    AND target_id IS NOT NULL
    AND actor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_story_like_unique
  ON notifications_feed (user_id, type, target_id, actor_id)
  WHERE type = 'story_like'
    AND target_id IS NOT NULL
    AND actor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_thread_cash_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'thread_cash_received'
    AND target_id IS NOT NULL;

-- Dismissed "Suggested for you" rows on the Activity tab.
CREATE TABLE IF NOT EXISTS suggestion_dismissals (
  user_id           text NOT NULL,
  suggested_user_id text NOT NULL,
  created_at        timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, suggested_user_id)
);
