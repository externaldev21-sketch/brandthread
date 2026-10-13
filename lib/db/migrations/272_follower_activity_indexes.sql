-- "Best time to drop" (GET /api/product-launches/best-time) reads a seller's
-- followers' store visits over the last 28 days by viewer. store_visits was
-- only indexed by seller and product, so this lookup scanned the table.
-- Additive and idempotent; no data changes.
CREATE INDEX IF NOT EXISTS store_visits_viewer_created_idx
  ON store_visits (viewer_user_id, created_at)
  WHERE viewer_user_id IS NOT NULL;
