-- ─── Migration 118: 1:1 DM calls (real Agora voice/video calls) ─────────────
-- One row per call placed between the two participants of a 1:1 DM
-- conversation (buyer ↔ seller or buyer ↔ buyer). Server-side source of truth
-- for the ringing → accepted → ended state machine driven by
-- artifacts/api-server/src/routes/call.ts (/api/call/dm/calls…) and pushed in
-- realtime over /ws/calls (artifacts/api-server/src/ws/callHub.ts). Every
-- transition is a conditional UPDATE (… WHERE id = ? AND status = ?) so a
-- concurrent accept/end can never both win. The rows also feed the call-log
-- bubbles shown to both sides of the conversation. Idempotent.

CREATE TABLE IF NOT EXISTS dm_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id       TEXT NOT NULL,
  callee_id       TEXT NOT NULL,
  mode            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ringing',
  -- `dmcall_<id without dashes>` — unique per call, not per conversation.
  channel_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at     TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  ended_by        TEXT,
  end_reason      TEXT,
  -- "How was the quality of your call?" on the call-ended screen, per side.
  quality_rating_caller TEXT,
  quality_rating_callee TEXT,
  CONSTRAINT dm_calls_mode_valid
    CHECK (mode IN ('voice', 'video')),
  CONSTRAINT dm_calls_status_valid
    CHECK (status IN ('ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended', 'failed')),
  CONSTRAINT dm_calls_quality_rating_caller_valid
    CHECK (quality_rating_caller IS NULL OR quality_rating_caller IN ('good', 'not_good')),
  CONSTRAINT dm_calls_quality_rating_callee_valid
    CHECK (quality_rating_callee IS NULL OR quality_rating_callee IN ('good', 'not_good'))
);

CREATE INDEX IF NOT EXISTS dm_calls_conversation_created_idx
  ON dm_calls (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dm_calls_callee_status_idx
  ON dm_calls (callee_id, status);

CREATE INDEX IF NOT EXISTS dm_calls_caller_status_idx
  ON dm_calls (caller_id, status);

-- At most one live (ringing/accepted) call per conversation, so two people
-- calling each other at the same instant can't both create a call.
CREATE UNIQUE INDEX IF NOT EXISTS dm_calls_one_live_per_conversation_idx
  ON dm_calls (conversation_id)
  WHERE status IN ('ringing', 'accepted');
