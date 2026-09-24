-- Migration 085: Saved collections (boards) + price/stock tracking on saved items

-- ─── Collections (buyer boards) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  cover_image_url TEXT,
  is_public       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS saved_collections_user_id_idx ON saved_collections(user_id, sort_order);

-- ─── Extend saved_items: collection membership + price/stock tracking ─────────
ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES saved_collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS saved_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS last_notified_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS was_out_of_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS back_in_stock_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notify_on_price_drop BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS saved_items_collection_id_idx ON saved_items(collection_id);

-- The Drizzle model never declared the (user_id, target_id) uniqueness that this
-- table has always relied on for idempotent saves (see migration 007). Bringing
-- it in sync here so drizzle-kit push on a fresh DB matches production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_items_user_id_target_id_key'
  ) THEN
    ALTER TABLE saved_items ADD CONSTRAINT saved_items_user_id_target_id_key UNIQUE (user_id, target_id);
  END IF;
END $$;
