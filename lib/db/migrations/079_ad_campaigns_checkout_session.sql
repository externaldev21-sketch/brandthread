-- Migration 079: Replace ad_campaigns PaymentIntent fields with Checkout Session fields
-- The Create Ad flow now uses Stripe Checkout (hosted payment page) instead of PaymentIntent.
-- Campaigns activate ONLY via checkout.session.completed webhook (payment_status = paid).
-- The idempotency_key column is dropped; session reuse is handled via stripe_checkout_session_id.

-- Add new Checkout Session columns (safe to add even if table is empty)
ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS checkout_session_version    INTEGER NOT NULL DEFAULT 0;

-- Drop the old PaymentIntent columns (may not exist if 078 ran with them)
ALTER TABLE ad_campaigns
  DROP COLUMN IF EXISTS stripe_payment_intent_id,
  DROP COLUMN IF EXISTS payment_idempotency_key;

-- Replace the old PI status index with a Checkout Session one
DROP INDEX IF EXISTS ad_campaigns_pi_status_idx;

CREATE INDEX IF NOT EXISTS ad_campaigns_cs_status_idx
  ON ad_campaigns(stripe_checkout_session_id, status)
  WHERE stripe_checkout_session_id IS NOT NULL;
