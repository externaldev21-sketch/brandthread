-- 292: seller Live map, index for "today's paid orders for this seller"
-- GET /api/seller/live-map/today filters orders by owner_id and a paid_at
-- window (local midnight .. now); the existing orders_owner_created_idx is on
-- created_at, which a paid-today scan can't use.
CREATE INDEX IF NOT EXISTS orders_owner_paid_at_idx
  ON orders (owner_id, paid_at DESC)
  WHERE paid_at IS NOT NULL;
