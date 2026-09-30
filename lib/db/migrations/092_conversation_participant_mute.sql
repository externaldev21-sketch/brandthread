-- Migration 092: per-user conversation mute preference.
-- Idempotent so it can be safely applied to databases at different stages.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT false;