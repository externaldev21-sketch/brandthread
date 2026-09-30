-- ─── Migration 108: Store visits (per-source traffic tracking) ───────────────
-- One row per real visit to a seller's store (product_id null) or a specific
-- product screen (product_id set), tagged with the real navigation source
-- (feed / search / profile / external). Unlike storefront_visits (which
-- dedupes a signed-in viewer once per seller per day for conversion-rate
-- math), this table records every real visit — including unauthenticated
-- buyers — so the seller Dashboard's Traffic sources panel can show a real
-- per-source breakdown instead of the former locked placeholder.

CREATE TABLE IF NOT EXISTS store_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  product_id UUID,
  source TEXT NOT NULL,
  viewer_user_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS store_visits_seller_id_idx
  ON store_visits (seller_id);

CREATE INDEX IF NOT EXISTS store_visits_seller_created_at_idx
  ON store_visits (seller_id, created_at);
