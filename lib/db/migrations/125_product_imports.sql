-- 125: Product imports (CSV: Shopify / Etsy / generic; Etsy Open API v3).
-- Side tables only — nothing here alters products / product_variants.
-- See lib/db/src/schema/productImports.ts.

-- Maps an imported source record to the product it created so a re-import
-- updates (or skips) instead of duplicating.
CREATE TABLE IF NOT EXISTS product_import_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT NOT NULL,
  source          TEXT NOT NULL,          -- shopify_csv | etsy_csv | generic_csv | etsy_api
  external_key    TEXT NOT NULL,          -- Shopify handle, Etsy listing id, generic sku/name slug
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  content_hash    TEXT NOT NULL DEFAULT '',
  last_run_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_import_mappings_owner_source_key_uq
  ON product_import_mappings (owner_id, source, external_key);
CREATE INDEX IF NOT EXISTS product_import_mappings_product_idx
  ON product_import_mappings (product_id);

-- One row per commit, for the "Recent imports" list.
CREATE TABLE IF NOT EXISTS product_import_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT NOT NULL,
  source          TEXT NOT NULL,
  filename        TEXT,
  created_count   INTEGER NOT NULL DEFAULT 0,
  updated_count   INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_import_runs_owner_idx
  ON product_import_runs (owner_id, created_at DESC);

-- Etsy connection (one per seller). Tokens are AES-256-GCM ciphertext.
CREATE TABLE IF NOT EXISTS etsy_connections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                TEXT NOT NULL UNIQUE,
  etsy_user_id            TEXT NOT NULL,
  shop_id                 TEXT,
  shop_name               TEXT,
  access_token_encrypted  TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,
  scopes                  TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'connected',
  last_error              TEXT,
  connected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at         TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived OAuth2 PKCE state (CSRF + verifier for the code exchange).
CREATE TABLE IF NOT EXISTS etsy_oauth_states (
  state                   TEXT PRIMARY KEY,
  owner_id                TEXT NOT NULL,
  code_verifier_encrypted TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at              TIMESTAMPTZ NOT NULL
);
