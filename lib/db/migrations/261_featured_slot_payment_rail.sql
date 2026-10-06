-- ─── Migration 261: how a Featured slot was paid (QA-0004) ───────────────────
-- Native iOS/Android apps buy Featured slots as App Store / Google Play
-- consumables through RevenueCat (Guideline 3.1.1); web keeps Stripe Checkout.
-- Store purchases cannot be refunded by Brandthread, so a rejected or
-- cancelled store-paid slot needs to know which rail paid for it.
--   'stripe' — Stripe Checkout (web)      'store' — App Store / Google Play
-- NULL on rows paid before this column existed (all of them Stripe).

ALTER TABLE featured_slots ADD COLUMN IF NOT EXISTS payment_rail TEXT;
