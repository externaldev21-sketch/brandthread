-- Migration 004: Seller subscription / platform billing
-- Completely separate from Stripe Connect (seller payouts).
-- stripe_customer_id  → the seller's Stripe Customer for recurring billing charges
-- subscription_id     → Stripe Subscription ID
-- subscription_status → active | trialing | past_due | canceled | none
-- subscription_period_end → when the current billing period ends
-- subscription_plan_id    → starter | growth | pro
-- Idempotent: uses ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id       TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status   TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS subscription_plan_id  TEXT DEFAULT 'starter';
