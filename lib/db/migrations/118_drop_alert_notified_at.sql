-- Notify-me launch alerts: each subscriber is pushed once when the drop goes
-- live (jobs/scheduledDropBroadcasts.ts → lib/dropBroadcast.ts
-- deliverDropLaunchAlerts), whether or not the seller also broadcast to
-- followers. notified_at is the per-subscription claim.
ALTER TABLE drop_alert_subscriptions ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS drop_alert_subscriptions_pending_idx
  ON drop_alert_subscriptions (drop_id)
  WHERE notified_at IS NULL;
