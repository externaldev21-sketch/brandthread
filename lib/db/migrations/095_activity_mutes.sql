-- Migration 095: "See less" mutes on the Activity tab.
--
-- One opaque key per mute so a single unique index covers both shapes this
-- feature needs — a whole notification type ("type:new_follower") or one
-- specific actor ("actor:<clerkId>") — without nullable partial-unique
-- columns. Consulted by GET /api/buyer/notifications (hides matching rows)
-- and publishNotification() (marks future matching rows is_muted at insert
-- time), so the preference sticks across devices, not just the current page.

CREATE TABLE IF NOT EXISTS activity_mutes (
  user_id    TEXT        NOT NULL,
  mute_key   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, mute_key)
);
