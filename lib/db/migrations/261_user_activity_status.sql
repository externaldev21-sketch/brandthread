-- 261: Activity status (Messages: green online dot, "Active now").
-- last_active_at is bumped (throttled) on authenticated requests.
-- show_activity_status mirrors Instagram's "Show activity status": off hides
-- your own status AND stops you seeing anyone else's.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_activity_status BOOLEAN NOT NULL DEFAULT TRUE;
