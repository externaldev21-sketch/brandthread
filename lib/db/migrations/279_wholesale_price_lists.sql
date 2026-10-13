-- 279: Wholesale price list (item 59). A seller's wholesale settings, fixed
-- per-product / per-variant wholesale prices with minimum quantities, and the
-- buyers approved to buy at wholesale. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS wholesale_settings (
  seller_id           text PRIMARY KEY,
  enabled             boolean NOT NULL DEFAULT false,
  -- wholesale subtotal the order must reach, else the whole order is retail
  min_order_cents     integer NOT NULL DEFAULT 0,
  -- % off retail for products without a fixed wholesale price (0..90)
  default_percent_off integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wholesale_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    text NOT NULL,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- null = every variant of the product; a variant row wins over its product row
  variant_id   uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  -- null = use the default % off
  price_cents  integer,
  min_quantity integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wholesale_prices_seller_idx ON wholesale_prices (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS wholesale_prices_product_uniq ON wholesale_prices (product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wholesale_prices_variant_uniq ON wholesale_prices (variant_id) WHERE variant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wholesale_buyers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     text NOT NULL,
  buyer_id      text NOT NULL,
  -- 'pending' | 'approved' | 'declined'
  status        text NOT NULL DEFAULT 'pending',
  business_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wholesale_buyers_seller_buyer_uniq') THEN
    ALTER TABLE wholesale_buyers ADD CONSTRAINT wholesale_buyers_seller_buyer_uniq UNIQUE (seller_id, buyer_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS wholesale_buyers_seller_status_idx ON wholesale_buyers (seller_id, status);
CREATE INDEX IF NOT EXISTS wholesale_buyers_buyer_idx ON wholesale_buyers (buyer_id);
