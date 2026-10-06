-- 124: Per-product SEO listing + variant compare-at prices (bulk price editor).
CREATE TABLE IF NOT EXISTS product_seo (
  product_id       UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL,
  seo_title        TEXT,
  seo_description  TEXT,
  url_handle       TEXT,
  no_index         BOOLEAN NOT NULL DEFAULT FALSE,
  social_image_url TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_seo_owner_handle_unique
  ON product_seo (owner_id, url_handle) WHERE url_handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_seo_owner_idx ON product_seo (owner_id);

CREATE TABLE IF NOT EXISTS product_variant_compare_at (
  variant_id       UUID PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  compare_at_cents INTEGER NOT NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
