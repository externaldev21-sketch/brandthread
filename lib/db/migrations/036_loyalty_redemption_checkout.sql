-- ─── Migration 036: Checkout-bound loyalty redemptions ──────────────────────
-- A redemption token is reserved by one Checkout Session and consumed only
-- when that paid session successfully creates an order.

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS loyalty_token TEXT,
  ADD COLUMN IF NOT EXISTS loyalty_discount_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE loyalty_points
  ADD COLUMN IF NOT EXISTS checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_order_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_redemption_token_unique
  ON loyalty_points(reference_id)
  WHERE source = 'redemption';

CREATE INDEX IF NOT EXISTS loyalty_redemption_checkout_idx
  ON loyalty_points(checkout_session_id)
  WHERE source = 'redemption';