-- 121: Variant option axes (fit + custom axes) and per-product stock rules.
CREATE TABLE IF NOT EXISTS product_option_axes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  values     TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_option_axes_product_name_uq ON product_option_axes (product_id, name);

CREATE TABLE IF NOT EXISTS product_variant_options (
  variant_id UUID PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  options    JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_stock_rules (
  product_id                  UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  low_stock_threshold_default INTEGER,
  sold_out_behavior           TEXT NOT NULL DEFAULT 'show',
  limited_quantity_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  limited_quantity_total      INTEGER,
  show_remaining_counter      BOOLEAN NOT NULL DEFAULT FALSE,
  counter_threshold           INTEGER,
  auto_hidden_at              TIMESTAMP,
  auto_archived_at            TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);
