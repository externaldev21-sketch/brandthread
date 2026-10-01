-- 112: Shipping labels for part of an order. A label bought for some items
-- records them here; shipping those items then reuses the existing item-level
-- tracking (order_items.tracking_number, migration 110). Whole-order labels
-- keep item_ids NULL and stay limited to one open label per order.
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS item_ids UUID[];
DROP INDEX IF EXISTS shipping_labels_one_open_per_order;
CREATE UNIQUE INDEX IF NOT EXISTS shipping_labels_one_open_per_order
  ON shipping_labels(order_id)
  WHERE status IN ('purchasing', 'active', 'void_pending') AND item_ids IS NULL;
CREATE INDEX IF NOT EXISTS shipping_labels_item_ids_idx ON shipping_labels USING GIN (item_ids);
