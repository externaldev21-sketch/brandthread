-- 264: Mystery boxes. A box is a normal product plus a pool of candidate
-- variants (same seller). Each paid box unit is resolved to one candidate
-- and recorded in mystery_box_picks (variant_id NULL = nothing in stock,
-- seller fulfils manually). Additive only; order_items is unchanged.
CREATE TABLE IF NOT EXISTS mystery_box_pools (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  reveal TEXT NOT NULL DEFAULT 'at_purchase'
    CHECK (reveal IN ('at_purchase', 'on_delivery')),
  show_odds BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mystery_box_pool_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES mystery_box_pools(product_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS mystery_box_pool_items_product_variant_uidx
  ON mystery_box_pool_items (product_id, variant_id);
CREATE INDEX IF NOT EXISTS mystery_box_pool_items_variant_idx
  ON mystery_box_pool_items (variant_id);

CREATE TABLE IF NOT EXISTS mystery_box_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  unit_index INTEGER NOT NULL DEFAULT 0,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  picked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mystery_box_picks_order_item_unit_uidx
  ON mystery_box_picks (order_item_id, unit_index);
