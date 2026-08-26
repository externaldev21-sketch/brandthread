-- ─── Migration 035: Deduplicated storefront visits ───────────────────────────
-- Seller metrics count a signed-in viewer once per seller per UTC day.

CREATE TABLE IF NOT EXISTS storefront_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  visit_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS storefront_visits_seller_visitor_day_unique
  ON storefront_visits (seller_id, visitor_id, visit_date);

CREATE INDEX IF NOT EXISTS storefront_visits_seller_id_idx
  ON storefront_visits (seller_id);