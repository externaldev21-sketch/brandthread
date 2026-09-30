-- 112: Automatic sales (percent / fixed amount off a store, selected products
-- or a collection for a date range) + persisted variant compare-at price.
-- Idempotent (IF NOT EXISTS).

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS compare_at_price_cents integer;

CREATE TABLE IF NOT EXISTS sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     text NOT NULL,
  name          text NOT NULL,
  -- 'percent' (value = 1..90) | 'fixed' (value = cents off each unit)
  discount_type text NOT NULL DEFAULT 'percent',
  value         integer NOT NULL,
  -- 'store' | 'products' | 'collection'
  scope         text NOT NULL DEFAULT 'store',
  -- collection name, matched against product category / tags (scope = 'collection')
  collection    text,
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_seller_active_idx ON sales (seller_id, active, starts_at);

CREATE TABLE IF NOT EXISTS product_sales (
  sale_id    uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (sale_id, product_id)
);

CREATE INDEX IF NOT EXISTS product_sales_product_idx ON product_sales (product_id);
