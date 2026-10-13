-- 276: Instant payout fee is 1.5% (Stripe's 1% + Brandthread's 0.5%).
-- The Brandthread part of each instant cash-out is fixed when the seller
-- confirms it, so a retry or an env change can never charge a different
-- amount. Collected after the payout by lib/money/instantPayoutFee.ts.
ALTER TABLE seller_cashout_attempts
  ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE seller_cashout_attempts
    ADD CONSTRAINT seller_cashout_attempts_platform_fee_nonnegative CHECK (platform_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
