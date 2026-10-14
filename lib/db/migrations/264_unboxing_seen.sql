-- 264: Unboxing moment — the first app open after an order is delivered
-- shows it once. Stamped the moment it is shown (or skipped) so it never
-- shows again for that order, on any device.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS unboxing_seen_at TIMESTAMPTZ;
