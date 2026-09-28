-- 106: Agora Cloud Recording bookkeeping for live streams.
--
-- Previously `live_streams.replay_url` existed but nothing ever set it, so
-- POST /api/live/:id/end always created a "replay" post — even with no
-- recording behind it (media_url fell back to ''). These columns let the
-- server track an Agora Cloud Recording session (acquire -> start -> stop ->
-- upload) per stream, so a replay post is only ever created once a real
-- recording has been confirmed uploaded (see routes/live.ts + the
-- liveRecordingFinalize job).
--
-- recording_status: 'none' (default; recording not configured or not yet
-- attempted) | 'acquiring' | 'started' | 'stopping' | 'uploaded' | 'failed'.
-- Used as an atomic idempotency guard (UPDATE ... WHERE recording_status =
-- '<expected>') so a retried start/stop request, or two concurrent end
-- requests, never double-acquire/double-start/double-stop the same stream.
--
-- recording_resource_id / recording_sid: Agora's resourceId + sid for the
-- acquired/started cloud recording session, needed verbatim for /stop and
-- /query. recording_uid: the synthetic Agora uid the recording bot joined
-- the channel as (distinct from the host/viewer uid ranges).
--
-- Not a payout-path change.

ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_resource_id TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_sid TEXT;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_uid INTEGER;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_started_at TIMESTAMPTZ;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_stopped_at TIMESTAMPTZ;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS recording_error TEXT;
