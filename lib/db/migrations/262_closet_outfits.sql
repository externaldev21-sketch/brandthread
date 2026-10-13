-- 262: Digital Closet outfits.
-- Closet pieces themselves are not stored: they are read live from the
-- buyer's delivered, non-refunded order items. An outfit is the buyer's saved
-- pick of those pieces (order_items ids, in board order).
CREATE TABLE IF NOT EXISTS closet_outfits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id   TEXT NOT NULL,
  piece_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS closet_outfits_buyer_idx ON closet_outfits (buyer_id, created_at DESC);
