-- 340: Loyalty / referral points are platform-funded (BT-066).
-- Brandthread's own rewards program no longer comes out of the seller's
-- payout. Each order records how much of the buyer's discount was loyalty
-- points, and the platform-funded top-up transfer that made the seller whole
-- (idempotency anchor, mirrors stripe_thread_cash_transfer_id).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS loyalty_applied_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_loyalty_transfer_id TEXT;
