ALTER TABLE shopify_import_collections
  ADD COLUMN IF NOT EXISTS source_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb;