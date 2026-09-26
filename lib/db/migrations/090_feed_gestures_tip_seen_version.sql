-- 090: Server-side persistence for the buyer "Watching Threads" gesture
-- coach mark, versioned so a future gesture change can re-show it once.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS feed_gestures_tip_seen_version INTEGER NOT NULL DEFAULT 0;
