-- Order numbers are now short, random and unique across every store
-- (BT-4821; see artifacts/api-server/src/lib/orderNumber.ts). Each new order
-- checks its candidate number against every existing order, so look-ups by
-- order_number need an index. Older per-store numbers (BT-00001) can repeat
-- across stores, so this index is deliberately not UNIQUE.
CREATE INDEX IF NOT EXISTS orders_order_number_idx ON orders (order_number);
