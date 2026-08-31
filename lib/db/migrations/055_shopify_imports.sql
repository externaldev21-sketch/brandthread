CREATE TABLE IF NOT EXISTS shopify_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'validating',
  imported_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  next_cursor TEXT,
  has_more BOOLEAN NOT NULL DEFAULT FALSE,
  source_store_name TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shopify_import_jobs_owner_created_idx
  ON shopify_import_jobs (owner_id, created_at);

CREATE TABLE IF NOT EXISTS shopify_import_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  import_job_id UUID NOT NULL REFERENCES shopify_import_jobs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopify_import_source_product_unique UNIQUE (owner_id, source_url, source_product_id)
);
CREATE INDEX IF NOT EXISTS shopify_import_product_mappings_job_idx
  ON shopify_import_product_mappings (import_job_id);

CREATE TABLE IF NOT EXISTS shopify_import_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  import_job_id UUID NOT NULL REFERENCES shopify_import_jobs(id) ON DELETE CASCADE,
  source_collection_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  source_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopify_import_source_collection_unique UNIQUE (owner_id, source_url, source_collection_id)
);