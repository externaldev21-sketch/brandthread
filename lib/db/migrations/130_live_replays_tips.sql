-- 130: Live replays on the seller's profile + Live tips feature flag.
--
-- replay_visibility: 'public' (default) | 'hidden'. A hidden replay is shown
-- only to its owner. The linked replay post is archived/published in step
-- (see routes/live-replays.ts) so it also drops out of the public video grid.
-- replay_deleted_at: soft delete by the owner; the replay is gone for everyone.
--
-- live_tips: server-side gate for POST /api/thread-cash/live-gift. Seeded OFF;
-- ON CONFLICT DO NOTHING so re-running never flips an operator's choice.

ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS replay_visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS replay_deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS live_streams_seller_replay_idx
  ON live_streams (seller_id, ended_at DESC)
  WHERE replay_url IS NOT NULL AND replay_deleted_at IS NULL;

INSERT INTO feature_flags (key, enabled, description)
VALUES ('live_tips', false, 'Viewers can tip (gift Thread Cash to) a live host. OFF until Thread Cash is finalised.')
ON CONFLICT (key) DO NOTHING;
