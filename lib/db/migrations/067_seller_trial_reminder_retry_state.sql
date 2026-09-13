-- Forward repair for databases that recorded migration 065 before retry-state
-- columns were added to that migration. Never rewrite applied migration history.
ALTER TABLE seller_trial_reminder_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE INDEX IF NOT EXISTS seller_trial_reminder_events_delivery_idx
  ON seller_trial_reminder_events (status, next_attempt_at, lease_expires_at)
  WHERE sent_at IS NULL;