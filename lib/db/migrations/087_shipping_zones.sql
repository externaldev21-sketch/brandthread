-- 087: Worldwide shipping zones.
--
-- Adds per-seller shipping zones (domestic / named countries / rest-of-world)
-- with flat or weight-tiered pricing, a free-shipping threshold, processing
-- time, an informational carrier/service label, and international/duties
-- flags. Additive only: the existing `shipping_rates` flat-rate table is left
-- in place for backward compatibility and remains the fallback when a seller
-- has no zones configured. Not a payout-path change — Stripe payment intent
-- construction and seller payout amounts are untouched by this migration;
-- only the shipping line item resolved at checkout time changes shape.

ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_ship_from_country TEXT NOT NULL DEFAULT 'US';

-- Per-variant weight, so weight-tiered shipping zones can resolve a real
-- cart weight at checkout. Additive, defaults to 0 (unknown) for existing rows.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS weight_grams INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS shipping_zones (
  id                      TEXT PRIMARY KEY DEFAULT '',
  seller_id               TEXT NOT NULL,
  name                    TEXT NOT NULL,
  zone_type               TEXT NOT NULL DEFAULT 'country',
  countries               JSON NOT NULL DEFAULT '[]',
  pricing_model           TEXT NOT NULL DEFAULT 'flat',
  flat_rate_cents         INTEGER NOT NULL DEFAULT 0,
  free_above_cents        INTEGER,
  processing_days         INTEGER NOT NULL DEFAULT 2,
  carrier_label           TEXT,
  ships_internationally   BOOLEAN NOT NULL DEFAULT TRUE,
  duties_handling         TEXT NOT NULL DEFAULT 'dap',
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shipping_zones_seller_idx ON shipping_zones (seller_id);
CREATE INDEX IF NOT EXISTS shipping_zones_seller_active_order_idx ON shipping_zones (seller_id, active, sort_order);

CREATE TABLE IF NOT EXISTS shipping_zone_weight_tiers (
  id                TEXT PRIMARY KEY DEFAULT '',
  zone_id           TEXT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  min_weight_grams  INTEGER NOT NULL DEFAULT 0,
  max_weight_grams  INTEGER,
  rate_cents        INTEGER NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shipping_zone_weight_tiers_zone_idx ON shipping_zone_weight_tiers (zone_id, sort_order);
