-- 270: Saved items alerts (restock + price drop).
--
-- Buyers who saved a product are alerted when it comes back in stock or drops
-- in price, at most one alert of each kind per buyer per product per 48 hours.
-- The dedupe state lives on the saved row; the claim is a single
-- UPDATE ... RETURNING in lib/stockNotifications.ts.
ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS restock_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_drop_alerted_at TIMESTAMPTZ;

-- Alerts fan out from a product to everyone who saved it.
CREATE INDEX IF NOT EXISTS saved_items_target_id_idx ON saved_items (target_id);

-- The 48-hour window replaces the lifetime one-per-product feed dedupe
-- (migration 085), which would otherwise silently drop every later alert.
DROP INDEX IF EXISTS notifications_feed_price_drop_unique;
DROP INDEX IF EXISTS notifications_feed_back_in_stock_unique;

-- was_out_of_stock was never maintained before this release. Seed it from
-- current stock so buyers waiting on a sold-out product hear about its restock.
UPDATE saved_items s
SET was_out_of_stock = true
WHERE s.item_type = 'product'
  AND s.was_out_of_stock = false
  AND EXISTS (SELECT 1 FROM products p WHERE p.id::text = s.target_id)
  AND COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id::text = s.target_id), 0) = 0;

-- New "Saved items alerts" preference: carry over each buyer's existing
-- "Price & stock alerts" choice (push, in-app and email) so nobody who opted
-- out starts receiving these.
UPDATE users
SET notification_preferences = (
  notification_preferences::jsonb || jsonb_strip_nulls(jsonb_build_object(
    'saved_alerts',       notification_preferences::jsonb -> 'price_alerts',
    'inapp:saved_alerts', notification_preferences::jsonb -> 'inapp:price_alerts',
    'email:saved_alerts', notification_preferences::jsonb -> 'email:price_alerts'
  ))
)::json
WHERE NOT (notification_preferences::jsonb ? 'saved_alerts');
