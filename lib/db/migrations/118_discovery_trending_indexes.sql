-- Indexes for the recent-window scans behind GET /api/public/trending/products
-- and /trending/brands (views, saves, new follows in the last ~14 days).
CREATE INDEX IF NOT EXISTS store_visits_product_created_at_idx
  ON store_visits (product_id, created_at);
CREATE INDEX IF NOT EXISTS saved_items_type_created_at_idx
  ON saved_items (item_type, created_at);
CREATE INDEX IF NOT EXISTS follows_created_at_idx
  ON follows (created_at);
