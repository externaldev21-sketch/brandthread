-- 296: drop hype, index for a drop's notify-me signups over time
-- GET /api/drops/:id/hype buckets drop_alert_subscriptions by created_at for
-- one drop. The existing unique (drop_id, user_id) index finds the rows but
-- not in time order; this one serves both the filter and the ordering.
CREATE INDEX IF NOT EXISTS drop_alert_subscriptions_drop_created_idx
  ON drop_alert_subscriptions (drop_id, created_at);
