-- ─── Migration 142: Away auto-reply dedupe log + automated message marker ────
-- away_auto_replies: one row per (conversation, away window) — the primary
-- key is what makes "reply once per conversation per away window" atomic.
CREATE TABLE IF NOT EXISTS away_auto_replies (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  window_key TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, window_key)
);

-- Messages posted by the away auto-reply are flagged so clients can label
-- them and so the server never answers an automated message.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_automated BOOLEAN NOT NULL DEFAULT FALSE;
