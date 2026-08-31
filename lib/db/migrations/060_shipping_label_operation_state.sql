ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS previous_order_status TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS shipping_labels_one_open_per_order
  ON shipping_labels(order_id)
  WHERE status IN ('purchasing', 'active', 'void_pending');