-- ─── Migration 140: Seller canned replies (quick replies) ────────────────────
-- One row per saved reply, scoped to the owning seller. `shortcut` is an
-- optional "/word" trigger, unique per seller (case-insensitive).
CREATE TABLE IF NOT EXISTS seller_quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  shortcut TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seller_quick_replies_seller_idx
  ON seller_quick_replies (seller_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS seller_quick_replies_shortcut_unique
  ON seller_quick_replies (seller_id, lower(shortcut))
  WHERE shortcut IS NOT NULL;
