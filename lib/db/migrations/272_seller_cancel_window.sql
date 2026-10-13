-- 272: Seller-set buyer cancellation window.
-- Hours after an order is placed during which the buyer can cancel it from the
-- app. NULL keeps the platform default (through day 21, while the order has
-- not shipped). Allowed values are enforced by the API (1, 12, 24, 72).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS buyer_cancel_window_hours INTEGER;
