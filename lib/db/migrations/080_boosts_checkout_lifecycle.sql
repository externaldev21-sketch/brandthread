-- Migration 080: Boost Checkout Session lifecycle
-- Replaces the direct off-session PaymentIntent flow with durable Stripe Checkout Sessions.
-- Boosts now stay 'pending_payment' until checkout.session.completed confirms payment_status=paid.
-- Activation sets starts_at / ends_at / paid_at; those fields are NULL until payment is verified.

-- 1. Add Checkout Session columns
ALTER TABLE boosts
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS checkout_session_version     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at                      TIMESTAMPTZ;

-- 2. Add 'pending_payment' and 'failed' to the allowed status set by making starts_at nullable
--    (it was previously defaultNow() — new pending boosts won't have a value until activation).
ALTER TABLE boosts
  ALTER COLUMN starts_at DROP NOT NULL,
  ALTER COLUMN starts_at DROP DEFAULT;

-- 3. Index for fast webhook lookup by checkout session
CREATE INDEX IF NOT EXISTS boosts_cs_status_idx
  ON boosts(stripe_checkout_session_id, status)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- 4. Backfill: existing rows (all created before this migration) are 'active' with
--    stripe_payment_intent_id set. Mark them as already paid by setting paid_at = created_at.
UPDATE boosts
  SET paid_at = created_at
  WHERE paid_at IS NULL
    AND status IN ('active', 'completed', 'paused');
