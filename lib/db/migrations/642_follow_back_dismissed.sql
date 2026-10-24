-- 642: "Dismiss" on a follower in Connections > Incoming (the follow-back
-- prompt) is persisted on the follow row, set by the person being followed.
-- Nullable; the follow itself is untouched. A new follow row (unfollow then
-- follow again) starts undismissed.
ALTER TABLE follows ADD COLUMN IF NOT EXISTS follow_back_dismissed_at TIMESTAMP;
