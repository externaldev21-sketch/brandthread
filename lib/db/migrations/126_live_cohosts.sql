-- ─── Migration 126: Live co-hosts ────────────────────────────────────────────
-- A host invites another seller to co-host their live. Status machine:
--   invited  -> accepted | declined | cancelled
--   accepted -> removed (by host) | left (by co-host)
-- At most one open (invited/accepted) row per (stream, co-host).

CREATE TABLE IF NOT EXISTS live_cohosts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id    UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  host_id      TEXT NOT NULL,
  cohost_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'invited',
  agora_uid    INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS live_cohosts_open_unique
  ON live_cohosts (stream_id, cohost_id) WHERE status IN ('invited', 'accepted');
CREATE INDEX IF NOT EXISTS live_cohosts_cohost_status_idx
  ON live_cohosts (cohost_id, status);
CREATE INDEX IF NOT EXISTS live_cohosts_stream_idx
  ON live_cohosts (stream_id, status);
