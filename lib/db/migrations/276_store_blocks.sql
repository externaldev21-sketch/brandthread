-- 276: Store blocks — the product cards on the seller's store website
-- (brandthread.app/@handle), Stan Store style. One block per catalog product:
-- 'premade' (in stock, ships now) or 'preorder' (made after it's bought).
-- The thumbnail (card) and checkout page copy live here; price, stock and
-- pre-order terms stay on the product so checkout charges what the card says.
-- status: draft | published | removed (a removed block keeps its row so the
-- store is never re-seeded from the catalog).
CREATE TABLE IF NOT EXISTS store_blocks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             TEXT NOT NULL,
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  position              INTEGER NOT NULL DEFAULT 0,
  visible               BOOLEAN NOT NULL DEFAULT TRUE,
  status                TEXT NOT NULL DEFAULT 'draft',
  style                 TEXT NOT NULL DEFAULT 'callout',
  thumb_image           TEXT,
  title                 TEXT NOT NULL DEFAULT '',
  subtitle              TEXT NOT NULL DEFAULT '',
  button_text           TEXT NOT NULL DEFAULT '',
  checkout_image        TEXT,
  description           TEXT NOT NULL DEFAULT '',
  ship_by               TIMESTAMP,
  preorder_cap          INTEGER,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS store_blocks_seller_idx ON store_blocks (seller_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS store_blocks_seller_product_uidx ON store_blocks (seller_id, product_id);
