-- 123: "Complete the fit" pairings and one product video per product.
-- Side tables keyed by product id (no columns added to products).
CREATE TABLE IF NOT EXISTS product_pairings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  paired_product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_pairings_no_self CHECK (product_id <> paired_product_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS product_pairings_pair_unique ON product_pairings (product_id, paired_product_id);
CREATE INDEX IF NOT EXISTS product_pairings_product_position_idx ON product_pairings (product_id, position);

CREATE TABLE IF NOT EXISTS product_videos (
  product_id   UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  video_url    TEXT NOT NULL,
  poster_url   TEXT,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
