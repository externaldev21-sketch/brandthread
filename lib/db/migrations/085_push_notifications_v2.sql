-- 085: Push notifications v2 — token lifecycle, quiet hours / master switch,
-- notification batching, and unique indexes for new event types.
--
-- Every statement is idempotent so the runner can safely re-apply this file.

-- ── Push token lifecycle (Expo receipt-based cleanup) ──────────────────────
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;
CREATE INDEX IF NOT EXISTS push_tokens_user_active_idx ON push_tokens (user_id) WHERE is_active = true;

ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS receipt_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS notification_deliveries_receipt_pending_idx
  ON notification_deliveries (status)
  WHERE status = 'sent' AND provider_message_id IS NOT NULL AND receipt_checked_at IS NULL;

-- ── Master push switch + quiet hours ────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT NOT NULL DEFAULT 'UTC';

-- ── Notification batch queue (collapses bursty low-priority events) ────────
CREATE TABLE IF NOT EXISTS notification_batch_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  category        TEXT NOT NULL,
  type            TEXT NOT NULL,
  target_id       TEXT,
  target_type     TEXT,
  count           INTEGER NOT NULL DEFAULT 1,
  actor_names     JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta             TEXT,
  first_event_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_batch_queue_window_unique
    UNIQUE (user_id, category, type, target_id)
);
CREATE INDEX IF NOT EXISTS notification_batch_queue_first_event_idx ON notification_batch_queue (first_event_at);

-- ── New per-type unique indexes on notifications_feed for idempotent retries ─
CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_drop_live_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'drop_live' AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_price_drop_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'price_drop' AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_back_in_stock_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'back_in_stock' AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_low_stock_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'low_stock' AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_payout_sent_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'payout_sent' AND target_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_return_status_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type IN ('return_approved', 'return_denied', 'return_refunded', 'return_requested')
    AND target_id IS NOT NULL;
