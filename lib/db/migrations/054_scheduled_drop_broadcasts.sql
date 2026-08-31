-- Persist the launch-time follower notification schedule.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS scheduled_broadcast_at TIMESTAMPTZ;