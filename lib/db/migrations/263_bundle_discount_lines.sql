-- 263: Seller bundle discounts applied at checkout.
-- The bundle part of a checkout's merchandise discount, kept apart from the
-- discount code amount (which is recorded as that code's use). On orders it is
-- already inside discount_amount_cents; this column only says how much of it
-- came from bundles.
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS bundle_discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bundle_discount_cents INTEGER NOT NULL DEFAULT 0;
