-- 270: When a seller's Stripe subscription went past_due (BT-002).
-- A past_due seller keeps their plan for PAST_DUE_GRACE_DAYS (planCatalogue)
-- from this moment, then falls back to the free-tier limits. Set by the
-- customer.subscription.* / invoice.payment_failed webhooks, cleared when the
-- subscription is no longer past_due. NULL for existing rows: they keep the
-- previous behaviour until the next subscription event stamps them.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_past_due_since TIMESTAMPTZ;
