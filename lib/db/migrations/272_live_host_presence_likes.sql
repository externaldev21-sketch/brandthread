-- Live shopping: host presence + reactions (docs/flows/live-shopping.md).
--
-- host_last_seen_at — refreshed by the host's WebSocket heartbeat (or the
-- HTTP heartbeat fallback). jobs/liveStaleStreams.ts ends a stream whose
-- host has gone silent, so a crashed host never stays "live" in the feed.
-- like_count — tap-to-heart reactions viewers send during a live; the
-- running total is broadcast to the room.
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS host_last_seen_at TIMESTAMPTZ;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
-- The stale-stream sweep scans live streams by host silence.
CREATE INDEX IF NOT EXISTS live_streams_live_host_seen_idx
  ON live_streams (host_last_seen_at)
  WHERE status = 'live';
