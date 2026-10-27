-- 645: Full-catalog Shopify import over the OAuth connection.
--   * shopify_catalog_import_jobs: one row per run; the app polls it for live
--     progress ("23 of 61 products").
--   * shopify_product_links.image_map: Shopify image URL -> stored
--     /objects/... copy, so re-imports update in place without re-downloading.
CREATE TABLE IF NOT EXISTS shopify_catalog_import_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         TEXT NOT NULL,
  shop_domain      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  total_count      INTEGER,
  processed_count  INTEGER NOT NULL DEFAULT 0,
  imported_count   INTEGER NOT NULL DEFAULT 0,
  updated_count    INTEGER NOT NULL DEFAULT 0,
  skipped          JSON NOT NULL DEFAULT '[]'::json,
  images_stored    INTEGER NOT NULL DEFAULT 0,
  images_linked    INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shopify_catalog_import_jobs_owner_created_idx
  ON shopify_catalog_import_jobs (owner_id, created_at);

ALTER TABLE shopify_product_links ADD COLUMN IF NOT EXISTS image_map JSON NOT NULL DEFAULT '{}'::json;
