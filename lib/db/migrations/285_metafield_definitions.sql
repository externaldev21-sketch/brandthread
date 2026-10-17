-- 285: Seller metafield definitions (custom fields per store resource).
-- routes/seller-metafields.ts has queried this table since it was written, but
-- no migration ever created it, so every Metafields request answered 500.
-- Additive only.
CREATE TABLE IF NOT EXISTS metafield_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       TEXT NOT NULL,
  owner_resource TEXT NOT NULL,
  namespace      TEXT NOT NULL DEFAULT 'custom',
  key            TEXT NOT NULL,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'single_line_text_field',
  description    TEXT,
  pinned         BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS metafield_definitions_owner_key_uq
  ON metafield_definitions (owner_id, owner_resource, namespace, key);
CREATE INDEX IF NOT EXISTS metafield_definitions_owner_idx
  ON metafield_definitions (owner_id, owner_resource);
