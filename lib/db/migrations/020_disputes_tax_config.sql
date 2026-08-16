-- ─── Migration 020: Disputes + Seller Tax Config ────────────────────────────

-- 1. Stripe disputes / chargebacks (one row per Stripe dispute event)
CREATE TABLE IF NOT EXISTS disputes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id   TEXT NOT NULL UNIQUE,
  stripe_charge_id    TEXT,
  stripe_payment_intent_id TEXT,
  order_id            UUID REFERENCES orders(id) ON DELETE SET NULL,
  seller_id           TEXT NOT NULL,   -- Clerk user ID of the seller
  amount_cents        INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'usd',
  reason              TEXT,            -- Stripe dispute reason code
  status              TEXT NOT NULL DEFAULT 'needs_response',
  evidence_due_by     TIMESTAMP,
  evidence_json       JSONB NOT NULL DEFAULT '[]',   -- submitted evidence items
  stripe_evidence_details JSONB NOT NULL DEFAULT '{}',
  is_charge_refundable BOOLEAN NOT NULL DEFAULT TRUE,
  network_reason_code TEXT,
  customer_claim      TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_seller_idx ON disputes(seller_id);
CREATE INDEX IF NOT EXISTS disputes_order_idx  ON disputes(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS disputes_stripe_idx ON disputes(stripe_dispute_id);

-- 2. Seller tax configuration (Stripe Tax preferences per seller)
CREATE TABLE IF NOT EXISTS seller_tax_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             TEXT NOT NULL UNIQUE,
  stripe_tax_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  collect_duties        BOOLEAN NOT NULL DEFAULT FALSE,
  charge_shipping_tax   BOOLEAN NOT NULL DEFAULT FALSE,
  charge_vat            BOOLEAN NOT NULL DEFAULT FALSE,
  tax_calculation_mode  TEXT NOT NULL DEFAULT 'automatic',  -- 'automatic' | 'manual'
  stripe_tax_settings   JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_tax_config_seller_idx ON seller_tax_config(seller_id);
