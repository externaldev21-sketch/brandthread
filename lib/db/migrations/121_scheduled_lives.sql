-- 121: Scheduled lives + "Remind me". A seller schedules a live (title, time,
-- optional products); followers opt in to a reminder. jobs/scheduledLiveReminders.ts
-- sends one reminder shortly before start (reminder_sent_at is the claim), and
-- going live from a scheduled entry notifies once (started_notified_at).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS scheduled_lives (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  starts_at           TIMESTAMPTZ NOT NULL,
  product_tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'scheduled' | 'live' | 'cancelled'
  status              TEXT NOT NULL DEFAULT 'scheduled',
  stream_id           UUID,
  reminder_sent_at    TIMESTAMPTZ,
  started_notified_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_lives_status_starts_idx
  ON scheduled_lives (status, starts_at);
CREATE INDEX IF NOT EXISTS scheduled_lives_seller_idx
  ON scheduled_lives (seller_id, status, starts_at);

CREATE TABLE IF NOT EXISTS scheduled_live_reminders (
  scheduled_live_id UUID NOT NULL REFERENCES scheduled_lives(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scheduled_live_id, user_id)
);

CREATE INDEX IF NOT EXISTS scheduled_live_reminders_user_idx
  ON scheduled_live_reminders (user_id);
