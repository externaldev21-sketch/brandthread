-- ─── Migration 058: authoritative checkout tax + 1099-K payment ledger ──────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_charged_cents INTEGER NOT NULL DEFAULT 0;

-- The order id is the idempotency boundary. Source identifiers are retained
-- for audit/reconciliation, but a webhook retry can never create another row.
CREATE TABLE IF NOT EXISTS seller_tax_ledger (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                  TEXT NOT NULL,
  order_id                   UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  calendar_year              INTEGER NOT NULL,
  gross_payment_cents        INTEGER NOT NULL,
  tax_cents                  INTEGER NOT NULL DEFAULT 0,
  shipping_cents             INTEGER NOT NULL DEFAULT 0,
  currency                   TEXT NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id   TEXT,
  stripe_checkout_session_id TEXT,
  paid_at                    TIMESTAMP NOT NULL,
  created_at                 TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_tax_ledger_seller_year_idx
  ON seller_tax_ledger(seller_id, calendar_year);
CREATE INDEX IF NOT EXISTS seller_tax_ledger_checkout_idx
  ON seller_tax_ledger(stripe_checkout_session_id);

-- Safely backfill historical Stripe-paid physical-goods orders. Seller-created
-- orders have no Checkout Session and are intentionally excluded.
INSERT INTO seller_tax_ledger (
  seller_id, order_id, calendar_year, gross_payment_cents, tax_cents,
  shipping_cents, currency, stripe_payment_intent_id,
  stripe_checkout_session_id, paid_at
)
SELECT
  owner_id,
  id,
  EXTRACT(YEAR FROM created_at)::INTEGER,
  COALESCE(NULLIF(gross_charged_cents, 0), total_cents),
  tax_cents,
  shipping_cents,
  'usd',
  stripe_payment_intent_id,
  stripe_checkout_session_id,
  created_at
FROM orders
WHERE stripe_checkout_session_id IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;