-- Seller trial reminder state. All statements are intentionally idempotent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_trial_banner_dismissed_trial_end text;

-- One durable reminder state per seller and trial window. The trial end is the
-- stable trial identity even when Stripe retries an event with a new id.
CREATE TABLE IF NOT EXISTS seller_trial_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id text NOT NULL,
  trial_end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, trial_end_at)
);

CREATE INDEX IF NOT EXISTS seller_trial_reminder_events_trial_end_idx
  ON seller_trial_reminder_events (trial_end_at);

-- Safe to run after the table was created by an earlier version of this
-- migration during a rolling deploy.
ALTER TABLE seller_trial_reminder_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_feed_subscription_trial_day_4_unique
  ON notifications_feed (user_id, type, target_id)
  WHERE type = 'subscription_trial_day_4' AND target_id IS NOT NULL;