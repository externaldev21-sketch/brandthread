-- Migration 087: Discount codes — applies-to scope, per-customer limits, start
-- dates, free-item type, and a usage ledger so codes actually validate and
-- apply once at buyer checkout instead of only being spot-checked in the UI.

ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'entire_store',
  ADD COLUMN IF NOT EXISTS product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS one_use_per_customer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE discount_codes
    ADD CONSTRAINT discount_codes_applies_to_check
    CHECK (applies_to IN ('entire_store', 'specific_products'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE discount_codes
    ADD CONSTRAINT discount_codes_type_check
    CHECK (type IN ('percentage', 'fixed', 'free_shipping', 'free_item'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Records one real redemption of a code, so "one use per customer" and total
-- usage counts survive concurrent checkouts and can be audited.
CREATE TABLE IF NOT EXISTS discount_code_uses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id   TEXT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  seller_id          TEXT NOT NULL,
  customer_key       TEXT NOT NULL, -- buyer clerk id, or "guest:<email>" for guest checkout
  order_id           UUID,
  applied_amount_cents INTEGER NOT NULL DEFAULT 0,
  used_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discount_code_uses_code_idx ON discount_code_uses(discount_code_id);
CREATE INDEX IF NOT EXISTS discount_code_uses_customer_idx ON discount_code_uses(discount_code_id, customer_key);

-- The discount code reserved for a Stripe Checkout Session, consumed atomically
-- with order creation by the paid-order webhook (mirrors loyalty_token above).
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS discount_code_id TEXT,
  ADD COLUMN IF NOT EXISTS discount_code_amount_cents INTEGER NOT NULL DEFAULT 0;
