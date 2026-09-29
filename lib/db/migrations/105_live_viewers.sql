-- 105: Presence-based live viewer tracking.
--
-- Replaces the old increment-on-join / decrement-on-leave counter on
-- live_streams.viewer_count (routes/live.ts POST /:id/join and /:id/leave),
-- which drifted whenever a client disconnected without a clean leave call
-- (app killed, network drop, crash) — the count could only ever go up.
--
-- Each connected viewer (WebSocket connection, or the HTTP heartbeat
-- fallback used when a socket can't be established) upserts its own row
-- here every ~15s. viewer_count is then computed server-side as
-- `count(*) WHERE last_seen > now() - interval '45 seconds'` for a stream
-- and written back to live_streams.viewer_count / peak_viewer_count by a
-- periodic job (see jobs/liveViewersPresence.ts) — never mutated directly
-- by join/leave anymore.
--
-- One row per (stream_id, viewer): a viewer with multiple tabs/reconnects
-- just refreshes the same row's last_seen. Not a payout-path change.

CREATE TABLE IF NOT EXISTS live_viewers (
  stream_id             UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id_or_session_id TEXT NOT NULL,
  last_seen             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, user_id_or_session_id)
);

CREATE INDEX IF NOT EXISTS live_viewers_stream_last_seen_idx
  ON live_viewers (stream_id, last_seen);
