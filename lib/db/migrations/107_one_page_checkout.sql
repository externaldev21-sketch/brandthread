-- One-page checkout: a single in-app PaymentIntent for the whole cart,
-- separate charges and transfers to each seller, and stock reserved at pay
-- time. Additive only.

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS amount_total_cents INTEGER,
  ADD COLUMN IF NOT EXISTS shipping_cents INTEGER,
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_tax_calculation_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

CREATE INDEX IF NOT EXISTS checkout_sessions_payment_intent_idx
  ON checkout_sessions (stripe_payment_intent_id);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id      UUID NOT NULL,
  variant_id               UUID NOT NULL,
  quantity                 INTEGER NOT NULL CHECK (quantity > 0),
  status                   TEXT NOT NULL DEFAULT 'held',
  stripe_payment_intent_id TEXT,
  expires_at               TIMESTAMP NOT NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_reservations_checkout_idx
  ON stock_reservations (checkout_session_id);
CREATE INDEX IF NOT EXISTS stock_reservations_status_expires_idx
  ON stock_reservations (status, expires_at);

-- Orders paid through it use the new "transfer" charge model. Widen the
-- allowed values (the old ones stay valid).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_charge_model_valid;
ALTER TABLE orders ADD CONSTRAINT orders_charge_model_valid CHECK (
  charge_model IS NULL OR charge_model IN ('destination', 'held', 'transfer')
);

-- The in-app flow is the default; this flag turns the old Stripe-hosted
-- Checkout back on as the primary path (a kill switch) without a release.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('hostedCheckoutFallback', false, 'Send buyers to Stripe-hosted Checkout instead of the one-page in-app checkout')
ON CONFLICT (key) DO NOTHING;
