-- 280: One free trial per person, device and card (Dev's trial decision).
-- A row is written whenever a seller's trial starts (Stripe or the App Store /
-- Play via RevenueCat). Checkout skips the trial when the account or the
-- device already has one; a Stripe trial on a card that another account
-- already trialed with is cancelled before any charge.
CREATE TABLE IF NOT EXISTS seller_trial_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subscription_ref TEXT NOT NULL,
  install_id TEXT,
  card_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_trial_claims_ref_unique
  ON seller_trial_claims (provider, subscription_ref);
CREATE INDEX IF NOT EXISTS seller_trial_claims_clerk_idx ON seller_trial_claims (clerk_id);
CREATE INDEX IF NOT EXISTS seller_trial_claims_install_idx
  ON seller_trial_claims (install_id) WHERE install_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS seller_trial_claims_card_idx
  ON seller_trial_claims (card_fingerprint) WHERE card_fingerprint IS NOT NULL;

-- Stripe's cancel_at_period_end, mirrored so the reminder job and the plan
-- screen know a cancelled trial won't be charged.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
