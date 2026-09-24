-- Migration 085: Message reactions
-- A small fixed reaction bar on DM messages (no free-form emoji picker).
-- One active reaction per user per message; re-reacting replaces it, which
-- the unique constraint below enforces at the database level.

CREATE TABLE IF NOT EXISTS message_reactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  -- Enum: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'fire'
  reaction_type  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_reactions_message_user_unique
  ON message_reactions(message_id, user_id);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON message_reactions(message_id);
