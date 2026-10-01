-- 112: Seller cash-out payout method (standard bank payout vs Stripe Instant Payout).
-- Persisted with the attempt so a retry can never switch method.
ALTER TABLE seller_cashout_attempts ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'standard';
