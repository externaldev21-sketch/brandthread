-- 087: Manufacturer product catalog (quantity price tiers) and broadcast RFQs.
-- Net-new tables for the Manufacturer Hub B2B sourcing rebuild. Not a money-
-- path change — payments continue to go through existing sample_orders /
-- Stripe Connect flows untouched by this migration.

-- ── Manufacturer product/service catalog ────────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacturer_products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id        UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  category               TEXT NOT NULL DEFAULT '',
  images                 JSON NOT NULL DEFAULT '[]',
  moq                    INTEGER NOT NULL DEFAULT 1,
  lead_time_days         INTEGER NOT NULL DEFAULT 0,
  sample_price_cents     INTEGER NOT NULL DEFAULT 0,
  sample_price_label     TEXT,
  customization_options  JSON NOT NULL DEFAULT '[]',
  status                 TEXT NOT NULL DEFAULT 'active',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS manufacturer_products_manufacturer_idx
  ON manufacturer_products (manufacturer_id, status);

-- ── Quantity-tiered pricing per product ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS manufacturer_product_price_tiers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES manufacturer_products(id) ON DELETE CASCADE,
  min_quantity     INTEGER NOT NULL,
  max_quantity     INTEGER,
  unit_price_cents INTEGER NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS manufacturer_product_price_tiers_product_idx
  ON manufacturer_product_price_tiers (product_id, sort_order);

-- ── Seller RFQs (broadcast to many manufacturers) ───────────────────────────
CREATE TABLE IF NOT EXISTS seller_rfqs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id          TEXT NOT NULL,
  garment_type       TEXT NOT NULL,
  category           TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  quantity           INTEGER NOT NULL,
  target_price_cents INTEGER,
  deadline           TIMESTAMPTZ,
  file_ids           JSON NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_rfqs_seller_idx ON seller_rfqs (seller_id, created_at);

-- ── Link seller_quote_requests back to the RFQ that fanned it out ───────────
ALTER TABLE seller_quote_requests
  ADD COLUMN IF NOT EXISTS rfq_id UUID REFERENCES seller_rfqs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS seller_quote_requests_rfq_idx ON seller_quote_requests (rfq_id);
