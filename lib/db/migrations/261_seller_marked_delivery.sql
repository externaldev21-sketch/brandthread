-- 261: A seller may mark an order delivered when its carrier can't report
-- delivery (no tracking integration for that carrier). Recorded as
-- delivery_confirmed_by = 'seller' so it stays distinguishable from a
-- carrier scan or the buyer's own confirmation.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_confirmed_by_valid;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_confirmed_by_valid CHECK (
  delivery_confirmed_by IS NULL OR delivery_confirmed_by IN ('carrier', 'buyer', 'seller')
);
